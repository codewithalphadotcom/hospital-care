"""Operating room registry (story #28): registering rooms and changing their status."""

from django.db import IntegrityError, transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from apps.accounts.permissions import may_change
from apps.audit.services import record
from apps.resources.services import change_status

from .models import OperatingRoom

DUPLICATE_NAME = {"name": ["A room with this name is already registered in your hospital."]}


def register_operating_room(serializer, actor) -> OperatingRoom:
    """Save a new room in the actor's hospital and audit-log it. Names are unique per hospital, any case."""
    hospital = getattr(actor, "hospital", None)
    name = serializer.validated_data["name"]
    if OperatingRoom.objects.filter(hospital=hospital, name__iexact=name).exists():
        raise ValidationError(DUPLICATE_NAME)
    try:
        with transaction.atomic():
            room = serializer.save(hospital=hospital)
    except IntegrityError:  # someone registered the same name at the same moment
        raise ValidationError(DUPLICATE_NAME) from None
    record(
        actor,
        "operatingroom.registered",
        room,
        after={"name": room.name, "capabilities": room.capabilities, "status": room.status},
    )
    return room


@transaction.atomic
def apply_operating_room_action(room_id: int, action: str, *, actor, reason: str = "") -> OperatingRoom:
    """Move a room along its lifecycle, locking the row. Another hospital's room is a 404 (own-hospital
    rule, may_change), so its existence isn't revealed. Raises TransitionNotAllowed for a refused move."""
    room = get_object_or_404(OperatingRoom.objects.select_for_update(), pk=room_id)
    if not may_change(actor, room):
        raise Http404
    return change_status(room, action, actor=actor, reason=reason)
