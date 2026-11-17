"""Local availability (story #33): what a case's own hospital has for each need, and what is still short.

Worked out on read and never stored, because stock changes all the time. "Local" is the case's hospital.
Blood counts exact group and component matches only: cross-group compatibility (O- for anyone) is story #37.
"""

from dataclasses import dataclass

from django.db.models import Count

from apps.blood.models import BloodUnit
from apps.blood.services import usable_units
from apps.hospitals.models import Bed, BedStatus

from .models import EmergencyRequest, RequestItem, ResourceType


@dataclass(frozen=True)
class ItemAvailability:
    item: RequestItem
    available: int  # what the case's hospital has that matches this requirement exactly
    shortfall: int  # still needed from other hospitals: max(0, quantity - fulfilled - available)


def local_availability(case: EmergencyRequest) -> list[ItemAvailability]:
    """One row per need, in the order of `case.items`. One grouped query per resource type, however many.
    A case with no hospital has 0 available for everything and runs no query.

    Needs that draw on the same stock (two O- blood lines, two ICU lines) share it in list order: the first
    sees the whole stock and the next sees what is left. Otherwise two lines could both claim the same units
    and the shortfall would be undercounted.
    """
    items = list(case.items.all())
    if not items:
        return []
    left = _local_stock(case.hospital_id) if case.hospital_id else {}
    rows = []
    for item in items:
        key = _stock_key(item)
        available = left.get(key, 0)
        left[key] = available - min(available, max(0, item.quantity - item.fulfilled))
        shortfall = max(0, item.quantity - item.fulfilled - available)
        rows.append(ItemAvailability(item=item, available=available, shortfall=shortfall))
    return rows


def shortfall_items(case: EmergencyRequest) -> list[tuple[RequestItem, int]]:
    """Only the needs the case's hospital cannot cover, as (item, shortfall), in item order.

    This is the input to the matching step (#38), which asks other hospitals for these shortfalls and no more.
    """
    return [(row.item, row.shortfall) for row in local_availability(case) if row.shortfall > 0]


def _stock_key(item: RequestItem) -> tuple:
    if item.resource_type == ResourceType.BLOOD:
        return ("blood", item.blood_group, item.component)
    return ("bed", item.bed_type)


def _local_stock(hospital_id: int) -> dict[tuple, int]:
    """Usable blood units by (group, component) and free beds by type, at one hospital: two grouped queries.
    Blood is exact match only; the compatibility rules are story #37's."""
    blood = (
        usable_units(BloodUnit.objects.filter(hospital_id=hospital_id))
        .values("group", "component")
        .annotate(n=Count("id"))
        .order_by()
    )
    beds = (
        Bed.objects.filter(hospital_id=hospital_id, status=BedStatus.FREE)
        .values("bed_type")
        .annotate(n=Count("id"))
        .order_by()
    )
    return {
        **{("blood", row["group"], row["component"]): row["n"] for row in blood},
        **{("bed", row["bed_type"]): row["n"] for row in beds},
    }
