from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import module_permission, own_hospital
from apps.hospitals.models import DoctorShift
from apps.hospitals.serializers import DoctorSerializer
from apps.resources.state_machine import TransitionNotAllowed

from .models import EmergencyRequest, EmergencyStatus, RequestStatusChange
from .serializers import CaseActionSerializer, CaseDetailSerializer, CaseInputSerializer, CaseSerializer
from .services import apply_case_action, create_case


def case_queryset():
    return EmergencyRequest.objects.select_related("hospital", "created_by").prefetch_related("items")


def case_detail_queryset():
    """The list's queryset plus the timeline. Only the detail uses it, so the list stays light."""
    timeline = Prefetch("history", queryset=RequestStatusChange.objects.select_related("actor"))
    return case_queryset().prefetch_related(timeline)


class PublicStatusView(APIView):
    """GET /api/public/status/, no sign-in needed. Shape of `PublicStatus` in api/publicStatus.ts."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        er = EmergencyStatus.current()
        doctors = DoctorShift.objects.filter(is_active=True)
        return Response(
            {
                "updatedAt": er.updated_at.isoformat(),
                "emergency": {
                    "status": er.status,
                    "waitMinutes": er.wait_minutes,
                    "waitingCount": er.waiting_count,
                },
                "doctors": DoctorSerializer(doctors, many=True).data,
            }
        )


class CaseListView(APIView):
    """GET /api/emergencies/ → the user's hospital's cases, most severe first, then oldest first (every case
    for staff without one). POST opens a case with its needs (stories #30, #32; emergencies: edit)."""

    permission_classes = [module_permission("emergencies")]

    def get(self, request):
        cases = own_hospital(case_queryset(), request.user).by_priority()
        return Response(CaseSerializer(cases, many=True).data)

    def post(self, request):
        serializer = CaseInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        case = create_case(
            severity=data["severity"], patient_ref=data["patientRef"], items=data["items"], actor=request.user
        )
        return Response(CaseSerializer(case_queryset().get(pk=case.pk)).data, status=status.HTTP_201_CREATED)


class CaseDetailView(APIView):
    """GET /api/emergencies/<reference>/. Another hospital's case is 404, as if it didn't exist."""

    permission_classes = [module_permission("emergencies")]

    def get(self, request, reference):
        case = get_object_or_404(own_hospital(case_detail_queryset(), request.user), reference=reference)
        return Response(CaseDetailSerializer(case).data)


class CaseActionView(APIView):
    """POST /api/emergencies/<reference>/actions/ {"action": "startMatching", "note"?} → the updated case.
    A move the lifecycle refuses is 409 and changes nothing. Emergencies: edit, at the case's hospital."""

    permission_classes = [module_permission("emergencies")]

    def post(self, request, reference):
        serializer = CaseActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            case = apply_case_action(reference, data["action"], note=data["note"], actor=request.user)
        except TransitionNotAllowed as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(CaseDetailSerializer(case_detail_queryset().get(pk=case.pk)).data)
