"""Emergency cases in the API (stories #30, #32). Shapes match frontend/src/api/emergencies.ts."""

from rest_framework import serializers

from apps.blood.models import BloodGroup, Component
from apps.hospitals.models import BedType

from .models import EmergencyRequest, RequestItem, ResourceType, Severity

MAX_ITEMS = 10
MAX_QUANTITY = {ResourceType.BLOOD: 20, ResourceType.BED: 5}


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
