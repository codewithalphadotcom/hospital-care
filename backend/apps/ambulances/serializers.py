from rest_framework import serializers

from apps.hospitals.models import Hospital

from .models import AMBULANCE_LIFECYCLE, Ambulance, AmbulanceType


class AmbulanceActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=AMBULANCE_LIFECYCLE.actions)
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class AmbulanceSerializer(serializers.ModelSerializer):
    """Shape of `Ambulance` in frontend/src/api/ambulances.ts. POST takes identifier, type and hospitalId."""

    type = serializers.ChoiceField(choices=AmbulanceType.choices)
    status = serializers.CharField(read_only=True)
    statusSince = serializers.DateTimeField(source="status_since", read_only=True)
    hospitalId = serializers.PrimaryKeyRelatedField(
        source="hospital", queryset=Hospital.objects.filter(is_active=True), write_only=True, required=False
    )
    hospital = serializers.CharField(source="hospital.name", read_only=True, default=None)

    class Meta:
        model = Ambulance
        fields = ["id", "identifier", "type", "status", "statusSince", "hospitalId", "hospital"]
        read_only_fields = ["id"]

    def validate_identifier(self, value):
        value = value.strip().upper()
        if not value:
            raise serializers.ValidationError("Enter the asset tag.")
        return value
