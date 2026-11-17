from rest_framework import serializers

from .models import OR_LIFECYCLE, OperatingRoom, OrCapability, OrStatus


class OperatingRoomActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=OR_LIFECYCLE.actions)
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class OperatingRoomSerializer(serializers.ModelSerializer):
    """Shape of `OperatingRoom` in frontend/src/api/operatingRooms.ts. POST uses the same fields."""

    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=OrCapability.choices), allow_empty=False
    )
    status = serializers.ChoiceField(choices=OrStatus.choices, default=OrStatus.AVAILABLE)
    statusSince = serializers.DateTimeField(source="status_since", read_only=True)
    hospital = serializers.CharField(source="hospital.name", read_only=True, default=None)

    class Meta:
        model = OperatingRoom
        fields = ["id", "name", "capabilities", "location", "status", "statusSince", "hospital"]
        read_only_fields = ["id"]

    def validate_capabilities(self, value):
        """Drop repeats and store the codes sorted, so the same set always looks the same."""
        return sorted(set(value))
