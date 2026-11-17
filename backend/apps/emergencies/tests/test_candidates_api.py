"""Story #38: GET /api/emergencies/<reference>/candidates/, the other hospitals that can supply each short
need."""

import itertools
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.blood.models import BloodUnit, UnitStatus
from apps.emergencies.models import EmergencyRequest, RequestItem, RequestStatusChange
from apps.equipment.models import Equipment, EquipmentStatus
from apps.hospitals.models import Bed, BedStatus, Ward

pytestmark = pytest.mark.django_db

_numbers = itertools.count(1)
REFERENCE = "EC-2026-0001"


def unit(hospital, group="O-", component="redCells", expires_in=30):
    now = timezone.now()
    return BloodUnit.objects.create(
        donation_number=f"U{next(_numbers)}",
        hospital=hospital,
        group=group,
        component=component,
        collected_at=now - timedelta(days=10),
        expires_at=now + timedelta(days=expires_in),
        status=UnitStatus.AVAILABLE,
        location="Blood fridge 1",
    )


def bed(hospital, bed_type="icu", status=BedStatus.FREE):
    ward, _ = Ward.objects.get_or_create(
        code=f"ward-{hospital.pk}", defaults={"name": "Ward", "kind": "General", "hospital": hospital}
    )
    return Bed.objects.create(ward=ward, label=f"B{next(_numbers)}", bed_type=bed_type, status=status)


def ventilator(hospital):
    return Equipment.objects.create(
        hospital=hospital,
        identifier=f"VENT-{next(_numbers)}",
        equipment_type="ventilator",
        location="ICU",
        status=EquipmentStatus.AVAILABLE,
    )


def case(hospital, *needs):
    """Each need is a dict of RequestItem fields."""
    created = EmergencyRequest.objects.create(reference=REFERENCE, severity="critical", hospital=hospital)
    for need in needs:
        RequestItem.objects.create(request=created, **need)
    return created


def blood(quantity):
    return {"resource_type": "blood", "blood_group": "O-", "component": "redCells", "quantity": quantity}


def icu(quantity):
    return {"resource_type": "bed", "bed_type": "icu", "quantity": quantity}


def vents(quantity):
    return {"resource_type": "equipment", "equipment_type": "ventilator", "quantity": quantity}


def get(client, reference=REFERENCE):
    return client.get(reverse("emergency-case-candidates", args=[reference]))


def test_each_short_need_lists_the_hospitals_that_have_it(client_as, make_hospital):
    here = make_hospital(name="Here", latitude="24.860700", longitude="67.001100")
    there = make_hospital(name="There", latitude="24.960700", longitude="67.001100")  # about 11 km north
    spare = make_hospital(name="Spare")  # the default coordinates, close to here
    unit(here)  # one O- red cell at home: 3 of 4 short
    for _ in range(5):
        unit(there)
    bed(there, "icu")
    ventilator(spare)
    created = case(here, blood(4), icu(1), vents(2))
    doctor = client_as(Role.DOCTOR, hospital=here)

    res = get(doctor)

    assert res.status_code == 200
    body = res.json()
    assert body["reference"] == REFERENCE
    blood_item, bed_item, vent_item = body["items"]
    assert (blood_item["need"], blood_item["shortfall"]) == ("O- red cells", 3)
    assert (bed_item["need"], bed_item["shortfall"]) == ("ICU bed", 1)
    assert (vent_item["need"], vent_item["shortfall"]) == ("Ventilator", 2)
    assert [item["itemId"] for item in body["items"]] == list(
        created.items.order_by("id").values_list("pk", flat=True)
    )

    [there_blood] = blood_item["candidates"]
    assert there_blood["hospital"] == {"id": there.pk, "name": "There"}
    assert (there_blood["available"], there_blood["covers"]) == (5, True)
    assert there_blood["distanceKm"] == pytest.approx(11.1, abs=0.1)
    assert there_blood["travelMinutes"] == 17
    assert there_blood["earliestExpiry"] and there_blood["bestDonorRank"] == 0
    [there_bed] = bed_item["candidates"]
    assert (
        there_bed["available"] == 1 and "earliestExpiry" not in there_bed and "bestDonorRank" not in there_bed
    )
    [spare_vent] = vent_item["candidates"]
    assert (spare_vent["hospital"]["name"], spare_vent["available"], spare_vent["covers"]) == (
        "Spare",
        1,
        False,
    )


def test_a_need_with_nobody_to_give_it_has_no_candidates(client_as, make_hospital):
    here = make_hospital(name="Here")
    case(here, icu(1))

    [item] = get(client_as(Role.DOCTOR, hospital=here)).json()["items"]

    assert item["candidates"] == []


def test_only_the_short_needs_are_listed(client_as, make_hospital):
    here, there = make_hospital(name="Here"), make_hospital(name="There")
    bed(here, "icu")  # covers the bed need here
    bed(there, "icu")
    unit(there)
    case(here, icu(1), blood(2))

    body = get(client_as(Role.DOCTOR, hospital=here)).json()

    assert [item["need"] for item in body["items"]] == ["O- red cells"]


def test_a_case_covered_locally_has_no_items(client_as, make_hospital):
    here = make_hospital(name="Here")
    bed(here, "icu")
    case(here, icu(1))

    assert get(client_as(Role.DOCTOR, hospital=here)).json() == {"reference": REFERENCE, "items": []}


def test_another_hospitals_case_is_not_found(client_as, make_hospital):
    here, there = make_hospital(name="Here"), make_hospital(name="There")
    case(here, icu(1))

    assert get(client_as(Role.DOCTOR, hospital=there)).status_code == 404


def test_a_patient_is_refused(client_as, make_hospital):
    here = make_hospital(name="Here")
    case(here, icu(1))

    assert get(client_as(Role.PATIENT)).status_code == 403


def test_the_read_does_not_escalate_an_overdue_case(client_as, make_hospital, settings):
    """The list and the detail escalate an overdue critical case; this read leaves it alone."""
    settings.EMERGENCY_ESCALATION_MINUTES = 30
    here = make_hospital(name="Here")
    created = case(here, icu(1))
    RequestStatusChange.objects.create(
        request=created, to_status="open", action="create", at=timezone.now() - timedelta(hours=2)
    )
    doctor = client_as(Role.DOCTOR, hospital=here)

    get(doctor)
    created.refresh_from_db()
    assert created.status == "open"

    assert doctor.get(reverse("emergency-case", args=[REFERENCE])).status_code == 200
    created.refresh_from_db()
    assert created.status == "escalated"  # the setup is overdue: the detail read does escalate it
