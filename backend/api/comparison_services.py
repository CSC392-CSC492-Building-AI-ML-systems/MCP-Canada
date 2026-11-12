
"""Stores and processes user inputs for neighbourhood comparisons."""
import math

class Budget:
    """Stores the user's monthly income and housing budget."""

    def __init__(self, before_tax_income, monthly_rent, bedrooms):
        # The frontend supplies monthly income.
        self.monthly_income = None
        self.monthly_rent = None
        self.bedrooms = None

        self.set_monthly_income(before_tax_income)
        self.set_monthly_rent(monthly_rent)
        self.set_bedrooms(bedrooms)

    def get_before_tax_income(self):
        """Kept for compatibility with existing code."""
        return self.monthly_income

    def get_monthly_income(self):
        return self.monthly_income

    def get_monthly_rent(self):
        return self.monthly_rent

    def get_bedrooms(self):
        return self.bedrooms

    def set_monthly_income(self, income):
        if income is not None:
            if not math.isfinite(income) or income < 0:
                raise ValueError("Invalid monthly income.")
        self.monthly_income = income

    def set_before_tax_income(self, income):
        self.set_monthly_income(income)

    def set_monthly_rent(self, rent):
        if rent is not None:
            if not math.isfinite(rent) or rent < 0:
                raise ValueError("Invalid monthly rent budget.")
        self.monthly_rent = rent

    def set_bedrooms(self, bedrooms):
        if bedrooms not in (0, 1, 2, 3, 4, 5):
            raise ValueError("Bedroom count must be between 0 and 5.")
        self.bedrooms = bedrooms

    def rent_percentage_of_income(self, rent):
        """Returns the percentage of monthly income spent on rent."""
        if self.monthly_income is None or self.monthly_income <= 0:
            return None
        if rent is None or rent < 0:
            return None
        return (rent / self.monthly_income) * 100

    def is_within_budget(self, rent):
        """Returns True/False, or None when information is unavailable."""
        if self.monthly_rent is None or rent is None:
            return None
        return rent <= self.monthly_rent


class Destination:
    """Stores an address and its geocoded coordinates."""

    def __init__(self, address):
        self.address = address
        self.latitude = None
        self.longitude = None

    def get_address(self):
        return self.address

    def set_address(self, address):
        self.address = address

    def set_coordinates(self, latitude, longitude):
        if not -90 <= latitude <= 90:
            raise ValueError("Invalid latitude.")
        if not -180 <= longitude <= 180:
            raise ValueError("Invalid longitude.")

        self.latitude = latitude
        self.longitude = longitude

    def get_coordinates(self):
        return (self.latitude, self.longitude)

    def has_coordinates(self):
        return self.latitude is not None and self.longitude is not None


class Travel:
    """Stores the user's destinations and commuting preferences."""

    VALID_PREFERENCES = ["Transit", "Driving", "Walking", "Cycling"]

    def __init__(
        self,
        address,
        school_destination=None,
        travel_preference="Transit",
        max_one_way_minutes=30,
        work_destination=None
    ):
        self.address = Destination(address)
        self.work_destination = (
            Destination(work_destination) if work_destination else None
        )
        self.school_destination = (
            Destination(school_destination) if school_destination else None
        )

        self.set_travel_preference(travel_preference)
        self.set_max_one_way_minutes(max_one_way_minutes)

    def get_address(self):
        return self.address

    def get_work_destination(self):
        return self.work_destination

    def get_school_destination(self):
        return self.school_destination

    def get_travel_preference(self):
        return self.travel_preference

    def get_max_one_way_minutes(self):
        return self.max_one_way_minutes

    def set_address(self, address):
        self.address = Destination(address)

    def set_work_destination(self, destination):
        self.work_destination = (
            Destination(destination) if destination else None
        )

    def set_school_destination(self, destination):
        self.school_destination = (
            Destination(destination) if destination else None
        )

    def set_travel_preference(self, preference):
        if preference not in self.VALID_PREFERENCES:
            raise ValueError("Invalid travel preference.")
        self.travel_preference = preference

    def set_max_one_way_minutes(self, minutes):
        if not isinstance(minutes, (int, float)) or isinstance(minutes, bool):
            raise ValueError("Maximum commute must be a number.")
        if minutes <= 0:
            raise ValueError("Maximum commute must be positive.")
        self.max_one_way_minutes = minutes

    def set_address_coordinates(self, latitude, longitude):
        self.address.set_coordinates(latitude, longitude)

    def set_work_coordinates(self, latitude, longitude):
        if self.work_destination is not None:
            self.work_destination.set_coordinates(latitude, longitude)

    def set_school_coordinates(self, latitude, longitude):
        if self.school_destination is not None:
            self.school_destination.set_coordinates(latitude, longitude)


class Lifestyle:
    """Stores the user's selected lifestyle priorities."""

    PRIORITIES = [
        "Family-friendly",
        "Transit access",
        "Parks & green space",
        "Restaurants & nightlife",
        "Quiet & residential",
        "Cultural community",
        "Walkable errands",
        "Good school access"
    ]

    def __init__(self, priorities=None):
        self.priorities = []
        self.set_priorities(priorities if priorities is not None else [])

    def get_priorities(self):
        return self.priorities.copy()

    def set_priorities(self, priorities):
        if len(priorities) > 3:
            raise ValueError("Choose up to 3 priorities.")

        if any(priority not in self.PRIORITIES for priority in priorities):
            raise ValueError("Invalid lifestyle priority.")

        self.priorities = list(dict.fromkeys(priorities))

    def add_priority(self, priority):
        if priority not in self.PRIORITIES:
            raise ValueError("Invalid lifestyle priority.")

        if priority in self.priorities:
            return

        if len(self.priorities) >= 3:
            raise ValueError("You can select up to 3 priorities.")

        self.priorities.append(priority)

    def remove_priority(self, priority):
        if priority in self.priorities:
            self.priorities.remove(priority)


class Matters:
    """Stores how important each comparison factor is to the user."""

    FACTORS = {
        "affordability": 0,
        "commute_to_work": 0,
        "school_distance": 0,
        "nearby_amenities": 0,
        "safety": 0,
        "lifestyle_match": 0
    }

    def __init__(self, factors=None):
        self.factors = self.FACTORS.copy()

        if factors:
            for factor, score in factors.items():
                self.set_importance(factor, score)

    def get_factors(self):
        return self.factors.copy()

    def get_importance(self, factor):
        return self.factors.get(factor)

    def set_importance(self, factor, score):
        if factor not in self.factors:
            raise ValueError("Invalid comparison factor.")

        if (
            not isinstance(score, (int, float))
            or isinstance(score, bool)
            or not 0 <= score <= 5
        ):
            raise ValueError("Importance must be between 0 and 5.")

        self.factors[factor] = score


class Learning:
    """Stores the user's interests in neighbourhood history and context."""

    VALID_INTERESTS = [
        "Community stories",
        "Transport & growth",
        "Buildings & heritage"
    ]

    def __init__(self):
        self.selected_interests = []
        self.additional_notes = ""

    def get_selected_interests(self):
        return self.selected_interests.copy()

    def select_interest(self, interest):
        if interest not in self.VALID_INTERESTS:
            raise ValueError("Invalid learning interest.")

        if interest not in self.selected_interests:
            self.selected_interests.append(interest)

    def deselect_interest(self, interest):
        if interest in self.selected_interests:
            self.selected_interests.remove(interest)

    def get_additional_notes(self):
        return self.additional_notes

    def set_additional_notes(self, notes):
        self.additional_notes = str(notes)


class NeighbourhoodComparison:
    """Manages neighbourhoods selected for comparison."""

    MAX_NEIGHBOURHOODS = 5
    MIN_NEIGHBOURHOODS = 3

    def __init__(self):
        self.neighbourhoods = []

    def add_neighbourhood(self, neighbourhood_id):
        if not neighbourhood_id:
            raise ValueError("A neighbourhood ID is required.")

        if neighbourhood_id in self.neighbourhoods:
            return

        if len(self.neighbourhoods) >= self.MAX_NEIGHBOURHOODS:
            raise ValueError("Maximum of 5 neighbourhoods allowed.")

        self.neighbourhoods.append(neighbourhood_id)

    def remove_neighbourhood(self, neighbourhood_id):
        if neighbourhood_id in self.neighbourhoods:
            self.neighbourhoods.remove(neighbourhood_id)

    def get_neighbourhoods(self):
        return self.neighbourhoods.copy()

    def can_compare(self):
        return self.MIN_NEIGHBOURHOODS <= len(self.neighbourhoods) <= self.MAX_NEIGHBOURHOODS
