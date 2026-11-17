"""Equipment registry rules (story #26) and operational status (story #27)."""

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from apps.audit.services import record
from apps.resources.services import change_status

from .models import Equipment


def register_equipment(serializer, actor) -> Equipment:
    """Save new equipment in the actor's hospital and audit-log it. Asset tags are unique per hospital."""
    hospital = getattr(actor, "hospital", None)
    identifier = serializer.validated_data["identifier"]
    if Equipment.objects.filter(hospital=hospital, identifier__iexact=identifier).exists():
        raise ValidationError({"identifier": ["This asset tag is already registered in your hospital."]})
    try:
        with transaction.atomic():
            equipment = serializer.save(hospital=hospital)
    except IntegrityError:  # someone registered the same tag at the same moment
        raise ValidationError(
            {"identifier": ["This asset tag is already registered in your hospital."]}
        ) from None
    record(
        actor,
        "equipment.registered",
        equipment,
        after={
            "identifier": equipment.identifier,
            "type": equipment.equipment_type,
            "status": equipment.status,
        },
    )
    return equipment


@transaction.atomic
def apply_equipment_action(equipment_id: int, action: str, *, actor, reason: str = "") -> Equipment:
    """Move equipment along its lifecycle, locking the row. Items outside the actor's hospital are a 404,
    the same as the list hides them. Raises TransitionNotAllowed for a refused move."""
    items = Equipment.objects.select_for_update()
    if actor.hospital_id:
        items = items.filter(hospital_id=actor.hospital_id)
    return change_status(get_object_or_404(items, pk=equipment_id), action, actor=actor, reason=reason)
