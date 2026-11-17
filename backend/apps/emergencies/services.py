"""Emergency case rules (stories #30, #32). Every change is audit-logged."""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record

from .models import EmergencyRequest, RequestItem, ResourceType

REFERENCE_ATTEMPTS = 5


def next_reference(year: int) -> str:
    """`EC-<year>-<sequence>`, one higher than the year's last case. Numbers grow past 4 digits if needed."""
    prefix = f"EC-{year}-"
    numbers = [
        int(ref.removeprefix(prefix))
        for ref in EmergencyRequest.objects.filter(reference__startswith=prefix).values_list(
            "reference", flat=True
        )
    ]
    return f"{prefix}{max(numbers, default=0) + 1:04d}"


@transaction.atomic
def create_case(*, severity: str, patient_ref: str, items: list[dict], actor) -> EmergencyRequest:
    """
    Open a case with its needs at the actor's hospital and audit-log it. Two cases created at the same moment
    can pick the same reference; the unique constraint refuses the second, which retries with the next one
    (each attempt is a savepoint, so a refused one leaves nothing behind).
    """
    for attempt in range(REFERENCE_ATTEMPTS):
        try:
            with transaction.atomic():
                case = EmergencyRequest.objects.create(
                    reference=next_reference(timezone.localdate().year),
                    hospital=getattr(actor, "hospital", None),
                    created_by=actor,
                    severity=severity,
                    patient_ref=patient_ref.strip(),
                )
                break
        except IntegrityError:
            if attempt == REFERENCE_ATTEMPTS - 1:
                raise
    RequestItem.objects.bulk_create(
        RequestItem(
            request=case,
            resource_type=item["type"],
            blood_group=item.get("group", "") if item["type"] == ResourceType.BLOOD else "",
            component=item.get("component", "") if item["type"] == ResourceType.BLOOD else "",
            bed_type=item.get("bedType", "") if item["type"] == ResourceType.BED else "",
            quantity=item["quantity"],
        )
        for item in items
    )
    record(
        actor,
        "emergencyrequest.created",
        case,
        after={"severity": severity, "status": case.status, "items": len(items)},
    )
    return case
