"""SharePoint upload via Microsoft Graph.

Used by the notifications scheduler to drop closed-form PDFs into the
doc-control SharePoint folder. The Teams card then links to the SharePoint
file URL instead of calling the FastAPI app, so doc control don't need
network access to the portal.

Auth uses the client_credentials flow against the n8n Azure AD app
registration (stop-gap; IT to issue a dedicated reg with `Sites.Selected`
later).
"""
