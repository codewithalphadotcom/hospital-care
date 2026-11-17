"""Story #38 acceptance: the search over the seeded demo network returns in under a second, in a fixed number
of queries. Seeded data, as a demo sees it: a case at the second hospital, one need of each of the four types.
"""

import time
from io import StringIO

import pytest
from django.core.management import call_command

from apps.emergencies.models import EmergencyRequest, RequestItem
from apps.hospitals.models import Hospital
from apps.matching.candidates import candidates_for_case

pytestmark = pytest.mark.django_db

SECONDS = 1.0
QUERY_BUDGET = 10  # the case's items, four stock counts, one grouped search per item, one hospital fetch


def test_candidates_for_one_need_of_each_type_on_seeded_data_are_fast_and_bounded(
    django_assert_max_num_queries,
):
    call_command("seed_demo", stdout=StringIO())
    origin = Hospital.objects.get(name="Seaview Hospital")
    case = EmergencyRequest.objects.create(reference="EC-2026-9001", severity="critical", hospital=origin)
    RequestItem.objects.bulk_create(
        [
            RequestItem(
                request=case, resource_type="blood", blood_group="A+", component="redCells", quantity=50
            ),
            RequestItem(request=case, resource_type="bed", bed_type="general", quantity=50),
            RequestItem(request=case, resource_type="equipment", equipment_type="ventilator", quantity=50),
            RequestItem(request=case, resource_type="operatingRoom", capability="general", quantity=50),
        ]
    )
    case = EmergencyRequest.objects.select_related("hospital").get(pk=case.pk)

    started = time.perf_counter()
    with django_assert_max_num_queries(QUERY_BUDGET):
        found = candidates_for_case(case)
    elapsed = time.perf_counter() - started

    assert elapsed < SECONDS, f"candidates_for_case took {elapsed:.3f}s"
    assert [entry.item.resource_type for entry in found] == ["blood", "bed", "equipment", "operatingRoom"]
    assert all(entry.candidates for entry in found), "every type should find a hospital with stock"
