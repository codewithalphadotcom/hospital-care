"""Ambulance registry rules (story #50): register at a base hospital, then move it along its lifecycle."""

from django.db import IntegrityError, transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Role
from apps.accounts.permissions import may_change
from apps.audit.services import record
from apps.resources.services import change_status

from .models import Ambulance

TAKEN = "This asset tag is already registered at this hospital."


def register_ambulance(serializer, actor) -> Ambulance:
    """Save a new ambulance at its base hospital and audit-log it. Non-admins register at their own hospital;
    admins choose one (hospitalId) or use their own. Tags are unique per hospital, ignoring case."""
    hospital = serializer.validated_data.get("hospital") if actor.effective_role == Role.ADMIN else None
    hospital = hospital or getattr(actor, "hospital", None)
    if hospital is None:
        raise ValidationError({"hospitalId": ["Pick the base hospital for this ambulance."]})
    identifier = serializer.validated_data["identifier"]
    if Ambulance.objects.filter(hospital=hospital, identifier__iexact=identifier).exists():
        raise ValidationError({"identifier": [TAKEN]})
    try:
        with transaction.atomic():
            ambulance = serializer.save(hospital=hospital)
    except IntegrityError:  # someone registered the same tag at the same moment
        raise ValidationError({"identifier": [TAKEN]}) from None
    record(
        actor,
        "ambulance.registered",
        ambulance,
        after={"identifier": ambulance.identifier, "type": ambulance.type, "status": ambulance.status},
    )
    return ambulance


@transaction.atomic
def apply_ambulance_action(ambulance_id: int, action: str, *, actor, reason: str = "") -> Ambulance:
    """Move an ambulance along its lifecycle, locking the row. Another hospital's ambulance is a 404 for
    users who may not change it (own-hospital rule). Raises TransitionNotAllowed if the move isn't allowed."""
    ambulance = get_object_or_404(Ambulance.objects.select_for_update(), pk=ambulance_id)
    if not may_change(actor, ambulance):
        raise Http404
    return change_status(ambulance, action, actor=actor, reason=reason)
