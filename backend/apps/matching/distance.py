"""Story 5.1: distance and estimated travel time between hospitals (#39).

Straight-line (Haversine) distance from coordinates, and a simulated travel-time estimate from an
average city driving speed. No real routing or traffic data — see docs/aidlc/inception for scope.
"""

import math
from decimal import Decimal

from django.conf import settings

EARTH_RADIUS_KM = 6371.0


def haversine_km(
    lat1: Decimal | float, lon1: Decimal | float, lat2: Decimal | float, lon2: Decimal | float
) -> float:
    """Straight-line distance in kilometres between two lat/long points."""
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_phi = math.radians(float(lat2) - float(lat1))
    d_lambda = math.radians(float(lon2) - float(lon1))

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def estimated_travel_minutes(distance_km: float, average_speed_kmh: float | None = None) -> float:
    """Simulated travel time in minutes: distance over an assumed average city driving speed.
    The speed defaults to settings.MATCHING_AVERAGE_SPEED_KMH (40 km/h unless overridden)."""
    speed = settings.MATCHING_AVERAGE_SPEED_KMH if average_speed_kmh is None else average_speed_kmh
    if speed <= 0:
        raise ValueError(f"Average speed must be positive, got {speed} km/h.")
    if distance_km < 0:
        raise ValueError(f"Distance can't be negative, got {distance_km} km.")
    return (distance_km / speed) * 60


def hospital_distance(hospital_a, hospital_b) -> float:
    """Straight-line distance in kilometres between two Hospital instances."""
    return haversine_km(hospital_a.latitude, hospital_a.longitude, hospital_b.latitude, hospital_b.longitude)
