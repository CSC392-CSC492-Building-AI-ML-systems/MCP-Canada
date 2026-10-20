""" Used to keep track of comparison indicator inputs from users"""


class Budget:
    """Stores the user's housing budget and bedroom requirements."""

    def __init__(self, before_tax_income, monthly_rent, bedrooms):
        self.income = before_tax_income
        self.monthly_rent = monthly_rent
        self.bedrooms = bedrooms

    def get_before_tax_income(self):
        return self.income

    def get_monthly_rent(self):
        return self.monthly_rent

    def get_bedrooms(self):
        return self.bedrooms

    def set_before_tax_income(self, income):
        self.income = income

    def set_monthly_rent(self, rent):
        self.monthly_rent = rent

    def set_bedrooms(self, bedrooms):
        self.bedrooms = bedrooms


class Destination:
    """
    Stores an address and its coordinates.
    Coordinates will be retrieved using a geocoding service.
    """

    def __init__(self, address):
        self.address = address
        self.latitude = None
        self.longitude = None

    def get_address(self):
        return self.address

    def set_coordinates(self, latitude, longitude):
        self.latitude = latitude
        self.longitude = longitude

    def get_coordinates(self):
        return (self.latitude, self.longitude)

class Travel:
    """Stores the user's commuting preferences and destinations."""

    def __init__(
            self,
            address,
            school_destination=None,
            travel_preference="Transit",
            max_one_way_minutes=30
    ):
        self.address = Destination(address)
        self.school_destination = (
            Destination(school_destination)
            if school_destination
            else None
        )
        self.travel_preference = travel_preference
        self.max_one_way_minutes = max_one_way_minutes

    def get_address(self):
        return self.address

    def get_school_destination(self):
        return self.school_destination

    def get_travel_preference(self):
        return self.travel_preference

    def get_max_one_way_minutes(self):
        return self.max_one_way_minutes

    def set_address(self, address):
        self.address = Destination(address)

    def set_school_destination(self, school_destination):
        if school_destination:
            self.school_destination = Destination(school_destination)
        else:
            self.school_destination = None

    def set_travel_preference(self, preference):
        self.travel_preference = preference

    def set_max_one_way_minutes(self, minutes):
        self.max_one_way_minutes = minutes

    def set_address_coordinates(self, latitude, longitude):
        self.address.set_coordinates(latitude, longitude)

    def set_school_coordinates(self, latitude, longitude):
        if self.school_destination is not None:
            self.school_destination.set_coordinates(
                latitude, longitude
            )



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

        for priority in priorities:
            if priority not in self.PRIORITIES:
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

    def __init__(self):
        # Importance scores start at 0
        self.factors = {
            "affordability": 0,
            "commute_to_work": 0,
            "school_distance": 0,
            "nearby_amenities": 0,
            "safety": 0,
            "lifestyle_match": 0
        }

    def get_factors(self):
        return self.factors

    def get_importance(self, factor):
        return self.factors.get(factor)

    def set_importance(self, factor, score):
        if factor in self.factors and 0 <= score <= 5:
            self.factors[factor] = score

class Learning:

    def __init__(self):
        # No interests selected initially
        self.selected_interests = []

        # Optional text starts empty
        self.additional_notes = ""

    def get_selected_interests(self):
        return self.selected_interests

    def select_interest(self, interest):
        valid_interests = [
            "Community stories",
            "Transport & growth",
            "Buildings & heritage"
        ]

        if (interest in valid_interests
                and interest not in self.selected_interests):
            self.selected_interests.append(interest)

    def deselect_interest(self, interest):
        if interest in self.selected_interests:
            self.selected_interests.remove(interest)

    def get_additional_notes(self):
        return self.additional_notes

    def set_additional_notes(self, notes):
        self.additional_notes = notes