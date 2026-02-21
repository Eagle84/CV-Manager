export type ApplicationStatus = "submitted" | "received" | "rejected" | "interview" | "assessment" | "offer" | "withdrawn";
export type FollowupState = "open" | "done" | "snoozed";
export interface ApplicationSummary {
    id: string;
    companyName: string;
    companyDomain: string;
    roleTitle: string;
    normalizedRoleTitle: string;
    groupSenderDomain?: string;
    groupSubjectKey?: string;
    status: ApplicationStatus;
    firstSeenAt: string;
    lastActivityAt: string;
    notes: string;
}
export interface ApplicationEventDto {
    id: string;
    applicationId: string;
    eventType: string;
    eventAt: string;
    emailMessageId: string | null;
    detailsJson: string;
}
export interface EmailMessageDto {
    id: string;
    gmailMessageId: string;
    threadId: string;
    direction: "inbound" | "outbound";
    fromEmail: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    sentAt: string | null;
    receivedAt: string | null;
    parsedCompanyDomain: string;
    parsedRole: string;
    classification: string;
    groupSenderDomain?: string;
    groupSubjectKey?: string;
    aiConfidence?: number;
}
export interface FollowupTaskDto {
    id: string;
    applicationId: string;
    dueAt: string;
    reason: string;
    state: FollowupState;
}
export interface ApplicationDetail extends ApplicationSummary {
    events: ApplicationEventDto[];
    emails: EmailMessageDto[];
    followups: FollowupTaskDto[];
}
export interface DuplicateCheckResponse {
    exists: boolean;
    key: string;
    matchedApplication: ApplicationSummary | null;
}
export interface DashboardSummary {
    totalApplications: number;
    statusCounts: Record<ApplicationStatus, number>;
    followupsDue: number;
    recentApplications: ApplicationSummary[];
}
