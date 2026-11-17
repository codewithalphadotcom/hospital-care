"""Emergency cases in the API (stories #30, #32). Shapes match frontend/src/api/emergencies.ts."""

from rest_framework import serializers

from apps.blood.models import BloodGroup, Component
from apps.hospitals.models import BedType

from .availability import local_availability
from .models import (
    REQUEST_LIFECYCLE,
    EmergencyRequest,
    RequestItem,
    RequestStatusChange,
    ResourceType,
    Severity,
)

MAX_ITEMS = 10
MAX_QUANTITY = {ResourceType.BLOOD: 20, ResourceType.BED: 5}
MAX_NOTE = 500


class RequestItemSerializer(serializers.Serializer):
    """`{type: "blood", group, component, quantity}` or `{type: "bed", bedType, quantity}`."""

    type = serializers.ChoiceField(choices=ResourceType.choices)
    group = serializers.ChoiceField(choices=BloodGroup.choices, required=False)
    component = serializers.ChoiceField(choices=Component.choices, required=False)
    bedType = serializers.ChoiceField(choices=BedType.choices, required=False)
    quantity = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        kind = attrs["type"]
        needed = ["group", "component"] if kind == ResourceType.BLOOD else ["bedType"]
        missing = {field: "This field is required." for field in needed if field not in attrs}
        if missing:
            raise serializers.ValidationError(missing)
        if attrs["quantity"] > MAX_QUANTITY[kind]:
            raise serializers.ValidationError(
                {"quantity": f"Ask for at most {MAX_QUANTITY[kind]} per item; add another item for more."}
            )
        return attrs

    def to_representation(self, item: RequestItem):
        data = {"type": item.resource_type, "quantity": item.quantity}
        if item.resource_type == ResourceType.BLOOD:
            data.update(group=item.blood_group, component=item.component)
        else:
            data["bedType"] = item.bed_type
        return data


class CaseInputSerializer(serializers.Serializer):
    """POST /api/emergencies/. No patient-identifying data: `patientRef` is optional and short."""

    severity = serializers.ChoiceField(choices=Severity.choices)
    patientRef = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    items = RequestItemSerializer(many=True, allow_empty=False)

    def validate_items(self, items):
        if len(items) > MAX_ITEMS:
            raise serializers.ValidationError(f"A case can list at most {MAX_ITEMS} needs.")
        return items


class CaseSerializer(serializers.ModelSerializer):
    """Shape of `EmergencyCase` in frontend/src/api/emergencies.ts."""

    id = serializers.CharField(source="reference")
    patientRef = serializers.CharField(source="patient_ref")
    hospital = serializers.SerializerMethodField()
    createdBy = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at")
    items = RequestItemSerializer(many=True)

    class Meta:
        model = EmergencyRequest
        fields = ["id", "severity", "status", "patientRef", "hospital", "createdBy", "createdAt", "items"]

    def get_hospital(self, case):
        return {"id": case.hospital_id, "name": case.hospital.name} if case.hospital else None

    def get_createdBy(self, case):
        user = case.created_by
        return (user.get_full_name() or user.email) if user else ""


class FeedNeedSerializer(RequestItemSerializer):
    """A need as the feed shows it: what is asked for, and how much of it is already fulfilled."""

    def to_representation(self, item: RequestItem):
        return {**super().to_representation(item), "fulfilled": item.fulfilled}


class FeedEntrySerializer(serializers.ModelSerializer):
    """One active request in the network feed (story #36). No `patientRef`, notes, timeline or author: the
    feed crosses hospitals, so it carries nothing patient-related and nothing about the staff who made the
    request. Shape of `FeedEntry` in frontend/src/api/emergencies.ts."""

    hospital = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at")
    needs = FeedNeedSerializer(source="items", many=True, read_only=True)

    class Meta:
        model = EmergencyRequest
        fields = ["reference", "hospital", "severity", "status", "createdAt", "needs"]

    def get_hospital(self, case):
        return {"id": case.hospital_id, "name": case.hospital.name} if case.hospital else None


class FeedQuerySerializer(serializers.Serializer):
    """GET /api/emergencies/feed/?type=: which needs the feed lists. Blood is the default."""

    type = serializers.ChoiceField(choices=ResourceType.choices, default=ResourceType.BLOOD)


class CaseActionSerializer(serializers.Serializer):
    """POST /api/emergencies/<reference>/actions/: one move along the lifecycle, with an optional note."""

    action = serializers.ChoiceField(choices=REQUEST_LIFECYCLE.actions)
    note = serializers.CharField(max_length=MAX_NOTE, required=False, allow_blank=True, default="")


class StatusChangeSerializer(serializers.ModelSerializer):
    """One timeline entry. Shape of `StatusChange` in frontend/src/api/emergencies.ts."""

    fromStatus = serializers.CharField(source="from_status")
    toStatus = serializers.CharField(source="to_status")
    actor = serializers.SerializerMethodField()
    at = serializers.DateTimeField()

    class Meta:
        model = RequestStatusChange
        fields = ["fromStatus", "toStatus", "action", "note", "actor", "at"]

    def get_actor(self, change):
        user = change.actor
        return (user.get_full_name() or user.email) if user else None


class CaseDetailSerializer(CaseSerializer):
    """One case with its timeline (oldest first), the actions valid from its current status (story #34), and
    what its hospital has for each need (story #33): `localAvailable` and `shortfall` per item, and the case's
    `shortfallTotal`. Only the detail computes availability, so the list stays cheap."""

    history = StatusChangeSerializer(many=True, read_only=True)
    actions = serializers.SerializerMethodField()
    outcome = serializers.SerializerMethodField()

    class Meta(CaseSerializer.Meta):
        # shortfallTotal: see to_representation
        fields = [*CaseSerializer.Meta.fields, "history", "actions", "outcome"]

    def to_representation(self, case):
        rows = local_availability(case)  # same order as the items below: both read case.items
        data = super().to_representation(case)
        data["items"] = [
            {**need, "localAvailable": row.available, "shortfall": row.shortfall}
            for need, row in zip(data["items"], rows, strict=True)
        ]
        data["shortfallTotal"] = sum(row.shortfall for row in rows)
        return data

    def get_actions(self, case):
        return [action for status, action in REQUEST_LIFECYCLE.transitions if status == case.status]

    def get_outcome(self, case):
        """The note of the latest close (story #35), or None. Reads the prefetched history: no extra query."""
        closes = [change for change in case.history.all() if change.action == "close"]
        return closes[-1].note if closes else None
