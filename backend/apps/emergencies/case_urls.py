from django.urls import path

from . import views

urlpatterns = [
    path("", views.CaseListView.as_view(), name="emergency-cases"),
    path("feed/", views.EmergencyFeedView.as_view(), name="emergency-feed"),
    path("<str:reference>/", views.CaseDetailView.as_view(), name="emergency-case"),
    path("<str:reference>/actions/", views.CaseActionView.as_view(), name="emergency-case-action"),
    path("<str:reference>/candidates/", views.CaseCandidatesView.as_view(), name="emergency-case-candidates"),
]
