"""Profile and comparison invariants; no database or external services required."""
from django.test import SimpleTestCase

from .comparison_services import Budget, Destination, Travel, Lifestyle, Matters, Learning, NeighbourhoodComparison


class BudgetContractTests(SimpleTestCase):
    def test_optional_inputs_remain_unknown(self):
        budget = Budget(None, None, 0)
        self.assertIsNone(budget.get_monthly_income())
        self.assertIsNone(budget.get_monthly_rent())
        self.assertIsNone(budget.rent_percentage_of_income(1000))
        self.assertIsNone(budget.is_within_budget(1000))

    def test_income_is_monthly_and_aliases_agree(self):
        budget = Budget(6000, 2400, 2)
        self.assertEqual(budget.get_monthly_income(), 6000)
        self.assertEqual(budget.get_before_tax_income(), 6000)
        self.assertEqual(budget.rent_percentage_of_income(2400), 40)
        self.assertEqual(budget.get_bedrooms(), 2)

    def test_income_updates_through_legacy_alias(self):
        budget = Budget(6000, 2400, 2)
        budget.set_before_tax_income(4000)
        self.assertEqual(budget.rent_percentage_of_income(2000), 50)

    def test_income_can_be_cleared(self):
        budget = Budget(6000, 2400, 2)
        budget.set_monthly_income(None)
        self.assertIsNone(budget.rent_percentage_of_income(1000))

    def test_zero_income_does_not_divide_by_zero(self):
        self.assertIsNone(Budget(0, 0, 0).rent_percentage_of_income(1000))

    def test_missing_and_negative_cost_do_not_produce_share(self):
        budget = Budget(5000, 2000, 1)
        self.assertIsNone(budget.rent_percentage_of_income(None))
        self.assertIsNone(budget.rent_percentage_of_income(-1))

    def test_budget_boundary_is_inclusive(self):
        budget = Budget(5000, 2000, 1)
        self.assertTrue(budget.is_within_budget(1999.99))
        self.assertTrue(budget.is_within_budget(2000))
        self.assertFalse(budget.is_within_budget(2000.01))

    def test_missing_cost_stays_unknown(self):
        self.assertIsNone(Budget(5000, 2000, 1).is_within_budget(None))

    def test_rent_budget_can_be_updated_and_cleared(self):
        budget = Budget(5000, 2000, 1)
        budget.set_monthly_rent(1500)
        self.assertFalse(budget.is_within_budget(1600))
        budget.set_monthly_rent(None)
        self.assertIsNone(budget.is_within_budget(1600))

    def test_invalid_income_is_rejected_without_changing_state(self):
        budget = Budget(5000, 2000, 1)
        for value in (-1, float("inf"), float("-inf"), float("nan")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                budget.set_monthly_income(value)
            self.assertEqual(budget.get_monthly_income(), 5000)

    def test_invalid_rent_is_rejected_without_changing_state(self):
        budget = Budget(5000, 2000, 1)
        for value in (-1, float("inf"), float("nan")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                budget.set_monthly_rent(value)
            self.assertEqual(budget.get_monthly_rent(), 2000)

    def test_supported_bedroom_counts(self):
        for bedrooms in range(6):
            with self.subTest(bedrooms=bedrooms):
                self.assertEqual(Budget(None, None, bedrooms).get_bedrooms(), bedrooms)

    def test_invalid_bedrooms_are_rejected(self):
        for bedrooms in (-1, 6, 1.5, "2", None):
            with self.subTest(bedrooms=bedrooms), self.assertRaises(ValueError):
                Budget(None, None, bedrooms)


class DestinationContractTests(SimpleTestCase):
    def test_coordinates_initially_unknown(self):
        destination = Destination("Synthetic address")
        self.assertEqual(destination.get_address(), "Synthetic address")
        self.assertFalse(destination.has_coordinates())
        self.assertEqual(destination.get_coordinates(), (None, None))

    def test_address_can_be_edited(self):
        destination = Destination("First")
        destination.set_address("Second")
        self.assertEqual(destination.get_address(), "Second")

    def test_coordinates_are_latitude_then_longitude(self):
        destination = Destination("Synthetic")
        destination.set_coordinates(43.7, -79.4)
        self.assertTrue(destination.has_coordinates())
        self.assertEqual(destination.get_coordinates(), (43.7, -79.4))

    def test_coordinate_limits_are_inclusive(self):
        destination = Destination("Synthetic")
        for point in ((-90, -180), (90, 180), (0, 0)):
            with self.subTest(point=point):
                destination.set_coordinates(*point)
                self.assertEqual(destination.get_coordinates(), point)

    def test_invalid_coordinates_do_not_partially_update(self):
        destination = Destination("Synthetic")
        destination.set_coordinates(43.7, -79.4)
        for point in ((91, 0), (0, 181), (-91, 0), (0, -181), (float("nan"), 0)):
            with self.subTest(point=point), self.assertRaises(ValueError):
                destination.set_coordinates(*point)
            self.assertEqual(destination.get_coordinates(), (43.7, -79.4))


class TravelContractTests(SimpleTestCase):
    def test_optional_destinations_are_absent(self):
        travel = Travel("Home")
        self.assertEqual(travel.get_address().get_address(), "Home")
        self.assertIsNone(travel.get_work_destination())
        self.assertIsNone(travel.get_school_destination())
        self.assertEqual(travel.get_travel_preference(), "Transit")
        self.assertEqual(travel.get_max_one_way_minutes(), 30)

    def test_work_and_school_have_independent_coordinates(self):
        travel = Travel("Home", school_destination="School", work_destination="Work")
        travel.set_address_coordinates(43.6, -79.3)
        travel.set_work_coordinates(43.7, -79.4)
        travel.set_school_coordinates(43.8, -79.5)
        self.assertEqual(travel.get_address().get_coordinates(), (43.6, -79.3))
        self.assertEqual(travel.get_work_destination().get_coordinates(), (43.7, -79.4))
        self.assertEqual(travel.get_school_destination().get_coordinates(), (43.8, -79.5))

    def test_changing_address_creates_an_unlocated_destination(self):
        travel = Travel("Old")
        travel.set_address_coordinates(43.7, -79.4)
        travel.set_address("New")
        self.assertEqual(travel.get_address().get_address(), "New")
        self.assertFalse(travel.get_address().has_coordinates())

    def test_destinations_can_be_added_and_cleared(self):
        travel = Travel("Home")
        travel.set_work_destination("Work")
        travel.set_school_destination("School")
        self.assertEqual(travel.get_work_destination().get_address(), "Work")
        self.assertEqual(travel.get_school_destination().get_address(), "School")
        travel.set_work_destination("")
        travel.set_school_destination(None)
        self.assertIsNone(travel.get_work_destination())
        self.assertIsNone(travel.get_school_destination())

    def test_coordinates_for_absent_destinations_are_ignored(self):
        travel = Travel("Home")
        travel.set_work_coordinates(43.7, -79.4)
        travel.set_school_coordinates(43.7, -79.4)
        self.assertIsNone(travel.get_work_destination())
        self.assertIsNone(travel.get_school_destination())

    def test_supported_travel_modes(self):
        travel = Travel("Home")
        for mode in Travel.VALID_PREFERENCES:
            with self.subTest(mode=mode):
                travel.set_travel_preference(mode)
                self.assertEqual(travel.get_travel_preference(), mode)

    def test_invalid_mode_does_not_replace_preference(self):
        travel = Travel("Home")
        with self.assertRaises(ValueError):
            travel.set_travel_preference("Teleport")
        self.assertEqual(travel.get_travel_preference(), "Transit")

    def test_positive_commute_limit_accepts_fractional_minutes(self):
        travel = Travel("Home")
        travel.set_max_one_way_minutes(12.5)
        self.assertEqual(travel.get_max_one_way_minutes(), 12.5)

    def test_commute_limit_rejects_nonpositive_or_nonnumeric_inputs(self):
        travel = Travel("Home")
        for value in (0, -1, True, "30", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                travel.set_max_one_way_minutes(value)
            self.assertEqual(travel.get_max_one_way_minutes(), 30)


class PriorityContractTests(SimpleTestCase):
    def test_lifestyle_starts_empty(self):
        self.assertEqual(Lifestyle().get_priorities(), [])

    def test_initial_priorities_deduplicate_and_preserve_order(self):
        self.assertEqual(Lifestyle(["Transit access", "Family-friendly", "Transit access"]).get_priorities(),
                         ["Transit access", "Family-friendly"])

    def test_lifestyle_caps_at_three(self):
        choices = Lifestyle.PRIORITIES[:3]
        priorities = Lifestyle(choices)
        with self.assertRaises(ValueError):
            priorities.add_priority(Lifestyle.PRIORITIES[3])
        self.assertEqual(priorities.get_priorities(), choices)

    def test_duplicate_priority_does_not_consume_a_slot(self):
        priorities = Lifestyle(Lifestyle.PRIORITIES[:3])
        priorities.add_priority(Lifestyle.PRIORITIES[0])
        self.assertEqual(len(priorities.get_priorities()), 3)

    def test_invalid_priority_is_rejected(self):
        priorities = Lifestyle()
        with self.assertRaises(ValueError):
            priorities.add_priority("Unknown")
        with self.assertRaises(ValueError):
            priorities.set_priorities(["Unknown"])
        self.assertEqual(priorities.get_priorities(), [])

    def test_bulk_priority_update_respects_limit(self):
        with self.assertRaises(ValueError):
            Lifestyle(Lifestyle.PRIORITIES[:4])

    def test_removing_priority_allows_new_selection(self):
        priorities = Lifestyle(Lifestyle.PRIORITIES[:3])
        priorities.remove_priority(Lifestyle.PRIORITIES[0])
        priorities.remove_priority("Already absent")
        priorities.add_priority(Lifestyle.PRIORITIES[3])
        self.assertEqual(priorities.get_priorities(), Lifestyle.PRIORITIES[1:4])

    def test_priority_lists_are_defensive_copies(self):
        initial = ["Transit access"]
        priorities = Lifestyle(initial)
        initial.clear()
        exported = priorities.get_priorities()
        exported.clear()
        self.assertEqual(priorities.get_priorities(), ["Transit access"])

    def test_weights_default_to_zero_and_instances_are_independent(self):
        one, two = Matters(), Matters()
        one.set_importance("safety", 5)
        self.assertEqual(two.get_importance("safety"), 0)
        self.assertEqual(len(two.get_factors()), 6)
        self.assertIsNone(two.get_importance("unknown"))

    def test_weights_accept_zero_five_and_fractional_values(self):
        weights = Matters({"safety": 5, "affordability": 0})
        weights.set_importance("school_distance", 2.5)
        self.assertEqual(weights.get_importance("school_distance"), 2.5)

    def test_invalid_weight_does_not_change_saved_value(self):
        weights = Matters({"safety": 3})
        for score in (-1, 6, True, "3", None, float("nan")):
            with self.subTest(score=score), self.assertRaises(ValueError):
                weights.set_importance("safety", score)
            self.assertEqual(weights.get_importance("safety"), 3)

    def test_unknown_weight_factor_is_rejected(self):
        with self.assertRaises(ValueError):
            Matters({"unknown": 2})

    def test_exported_weights_do_not_mutate_profile(self):
        weights = Matters()
        exported = weights.get_factors()
        exported["safety"] = 5
        self.assertEqual(weights.get_importance("safety"), 0)


class LearningContractTests(SimpleTestCase):
    def test_starts_empty(self):
        learning = Learning()
        self.assertEqual(learning.get_selected_interests(), [])
        self.assertEqual(learning.get_additional_notes(), "")

    def test_valid_interests_can_be_selected_once(self):
        learning = Learning()
        for interest in Learning.VALID_INTERESTS:
            learning.select_interest(interest)
            learning.select_interest(interest)
        self.assertEqual(learning.get_selected_interests(), Learning.VALID_INTERESTS)

    def test_unknown_interest_is_rejected(self):
        with self.assertRaises(ValueError):
            Learning().select_interest("Unknown")

    def test_deselection_is_idempotent(self):
        learning = Learning()
        learning.select_interest("Community stories")
        learning.deselect_interest("Community stories")
        learning.deselect_interest("Community stories")
        self.assertEqual(learning.get_selected_interests(), [])

    def test_returned_interests_are_independent(self):
        learning = Learning()
        learning.select_interest("Community stories")
        learning.get_selected_interests().clear()
        self.assertEqual(learning.get_selected_interests(), ["Community stories"])

    def test_notes_are_stored_as_text(self):
        learning = Learning()
        learning.set_additional_notes(123)
        self.assertEqual(learning.get_additional_notes(), "123")


class SelectionContractTests(SimpleTestCase):
    def test_requires_three_places(self):
        selection = NeighbourhoodComparison()
        self.assertFalse(selection.can_compare())
        selection.add_neighbourhood("a")
        selection.add_neighbourhood("b")
        self.assertFalse(selection.can_compare())
        selection.add_neighbourhood("c")
        self.assertTrue(selection.can_compare())

    def test_caps_at_five_and_keeps_existing_selection(self):
        selection = NeighbourhoodComparison()
        for name in "abcde":
            selection.add_neighbourhood(name)
        self.assertTrue(selection.can_compare())
        with self.assertRaises(ValueError):
            selection.add_neighbourhood("f")
        self.assertEqual(selection.get_neighbourhoods(), list("abcde"))

    def test_duplicate_does_not_count_twice_even_at_limit(self):
        selection = NeighbourhoodComparison()
        for name in "abcde":
            selection.add_neighbourhood(name)
        selection.add_neighbourhood("a")
        self.assertEqual(selection.get_neighbourhoods(), list("abcde"))

    def test_empty_id_is_rejected(self):
        with self.assertRaises(ValueError):
            NeighbourhoodComparison().add_neighbourhood("")

    def test_remove_and_export_do_not_corrupt_selection(self):
        selection = NeighbourhoodComparison()
        for name in "abc":
            selection.add_neighbourhood(name)
        selection.get_neighbourhoods().clear()
        selection.remove_neighbourhood("missing")
        selection.remove_neighbourhood("b")
        self.assertEqual(selection.get_neighbourhoods(), ["a", "c"])
        self.assertFalse(selection.can_compare())
