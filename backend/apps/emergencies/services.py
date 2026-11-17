"""Emergency case rules (stories #30, #32, #34). Every change is audit-logged; moves are in the timeline."""

from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone

from apps.accounts.permissions import may_change
from apps.audit.services import record

from .models import REQUEST_LIFECYCLE, EmergencyRequest, RequestItem, RequestStatusChange, ResourceType

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
    RequestStatusChange.objects.create(
        request=case, from_status="", to_status=case.status, action="create", actor=actor
    )
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


@transaction.atomic
def apply_case_action(reference: str, action: str, *, note: str, actor) -> EmergencyRequest:
    """
    Move a case along its lifecycle, with its timeline entry and an audit record, in one transaction. The row
    is locked, so two people can't move the same case at once. Another hospital's case is a 404, as if it
    didn't exist. Raises TransitionNotAllowed and saves nothing if the move isn't allowed from the status.
    """
    case = EmergencyRequest.objects.select_for_update().filter(reference=reference).first()
    if case is None or not may_change(actor, case):
        raise Http404("No emergency case with that id.")
    before = case.status
    case.status = REQUEST_LIFECYCLE.next(before, action)
    case.save(update_fields=["status"])
    RequestStatusChange.objects.create(
        request=case, from_status=before, to_status=case.status, action=action, note=note, actor=actor
    )
    record(
        actor,
        "emergencyrequest.status_changed",
        case,
        before={"status": before},
        after={"status": case.status},
        reason=note or action,
    )
    return case
