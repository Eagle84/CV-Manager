# Privacy Policy for CV Manager

**Last Updated: February 22, 2026**

This Privacy Policy describes how CV Manager ("we", "us", or "our") handles your data when you use our application.

## 1. Data Collection
CV Manager is a self-hosted tool designed to help users track job applications. We collect the following data through the Google OAuth process:
- **Email Address**: To identify your account and sync relevant job application emails.
- **Email Content**: To extract job application status updates, company names, and role titles.

## 2. How We Use Your Data
The data collected is used solely for:
- Synchronizing your job application history.
- Providing a dashboard to track your application pipeline.
- Generating local summaries of your job search progress.

## 3. Data Storage
CV Manager is designed to be run locally or on your private infrastructure. 
- All extracted data is stored in your local database (SQLite).
- We do not host a centralized database of your personal emails or CVs.

## 4. Third-Party Services
We use the following third-party services:
- **Google OAuth**: To access your Gmail messages.
- **Ollama**: To process and analyze email text locally for job-related information.

## 5. Data Security
Since this application runs on your own hardware, data security is primarily managed by your local environment. We recommend following standard security practices for self-hosted applications.

## 6. Your Rights
You can disconnect your Google account and delete all local data at any time through the application settings.

## 7. Contact
For any questions regarding this policy, please contact the repository maintainer through GitHub.
