from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import module_permission
from apps.resources.state_machine import TransitionNotAllowed

from .models import OperatingRoom, OrCapability, OrStatus
from .serializers import OperatingRoomActionSerializer, OperatingRoomSerializer
from .services import apply_operating_room_action, register_operating_room


class OperatingRoomListView(APIView):
    """
    GET /api/operating-rooms/?capability=cardiac&status=available&q=or → rooms in the user's hospital
    (the whole network for users without one). POST registers a room (operatingRooms: edit).
    """

    permission_classes = [module_permission("operatingRooms")]

    def get(self, request):
        rooms = OperatingRoom.objects.select_related("hospital")
        if request.user.hospital_id:
            rooms = rooms.filter(hospital_id=request.user.hospital_id)
        params = request.query_params
        if params.get("capability") in OrCapability.values:
            rooms = rooms.with_capability(params["capability"])
        if params.get("status") in OrStatus.values:
            rooms = rooms.filter(status=params["status"])
        if q := params.get("q", "").strip():
            rooms = rooms.filter(Q(name__icontains=q) | Q(location__icontains=q))
        return Response(OperatingRoomSerializer(rooms, many=True).data)

    def post(self, request):
        serializer = OperatingRoomSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        room = register_operating_room(serializer, request.user)
        return Response(OperatingRoomSerializer(room).data, status=status.HTTP_201_CREATED)


class OperatingRoomActionView(APIView):
    """POST /api/operating-rooms/<id>/actions/ {"action": "startCase", "reason"?} → the room (edit only)."""

    permission_classes = [module_permission("operatingRooms")]

    def post(self, request, pk):
        serializer = OperatingRoomActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            room = apply_operating_room_action(pk, data["action"], actor=request.user, reason=data["reason"])
        except TransitionNotAllowed as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(OperatingRoomSerializer(room).data)
