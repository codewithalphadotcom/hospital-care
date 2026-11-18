from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import module_permission
from apps.resources.state_machine import TransitionNotAllowed

from .models import Ambulance, AmbulanceStatus, AmbulanceType
from .serializers import AmbulanceActionSerializer, AmbulanceSerializer
from .services import apply_ambulance_action, register_ambulance


class AmbulanceListView(APIView):
    """
    GET /api/ambulances/?type=basic&status=available&q=amb-0 → the user's hospital's ambulances (admins: all).
    POST registers an ambulance (ambulances: edit).
    """

    permission_classes = [module_permission("ambulances")]

    def get(self, request):
        items = Ambulance.objects.select_related("hospital")
        if request.user.effective_role != Role.ADMIN:
            hospital_id = request.user.hospital_id
            items = items.filter(hospital_id=hospital_id) if hospital_id else items.none()
        params = request.query_params
        if params.get("type") in AmbulanceType.values:
            items = items.filter(type=params["type"])
        if params.get("status") in AmbulanceStatus.values:
            items = items.filter(status=params["status"])
        if q := params.get("q", "").strip():
            items = items.filter(Q(identifier__icontains=q))
        return Response(AmbulanceSerializer(items, many=True).data)

    def post(self, request):
        serializer = AmbulanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ambulance = register_ambulance(serializer, request.user)
        return Response(AmbulanceSerializer(ambulance).data, status=status.HTTP_201_CREATED)


class AmbulanceActionView(APIView):
    """POST /api/ambulances/<id>/actions/ {"action": "outOfService", "reason"?} → the ambulance (edit)."""

    permission_classes = [module_permission("ambulances")]

    def post(self, request, pk):
        serializer = AmbulanceActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            ambulance = apply_ambulance_action(pk, data["action"], actor=request.user, reason=data["reason"])
        except TransitionNotAllowed as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(AmbulanceSerializer(ambulance).data)
