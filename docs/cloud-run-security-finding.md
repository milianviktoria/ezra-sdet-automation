# Cloud Run Security Finding
## Wiz Investigation & Response
**Submitted by:** Viktoriia Milian | Senior SDET

---

## Overview

When I received this Wiz finding, my first instinct wasn't to immediately remediate — it was to understand the full picture before touching anything in production. A critical finding touching PHI in a healthcare environment demands precision, not speed. That said, speed still matters. Below is how I'd work through this in the first week, balancing urgency with accuracy and making sure I bring engineering along with me, not against me.

---

## Week 1 — Action Plan

**Day 1 — Confirm & Contain**
- Verify the finding is accurate: check ingress annotation, IAM policy, make an unauthenticated curl request
- Reach out to the engineering team lead via Slack, align before touching anything
- Remove allUsers from roles/run.invoker
- Change ingress to internal-only
- Notify the broader engineering team that a change is being made
- Document everything: who was notified, what was changed, at what time

**Day 2 — Investigate & Understand Blast Radius**
- Pull 14 days of Cloud Run request logs, identify all callers and traffic patterns
- Pull IAM audit logs, find out who added allUsers and when
- Map the service account permissions, confirm what PHI data was actually reachable
- Meet with the automation team, understand their use case, validate the claim
- Confirm whether CVE-2025-15467 is exploitable in the running image or just a transitive dependency

**Day 3 — Replace allUsers with Proper Auth**
- Create a dedicated service account for each automation caller
- Grant invoker permission to those service accounts only
- Provide the automation team with the OIDC token code snippet
- Verify automation still works end-to-end after the auth change
- Run verification tests: confirm unauthenticated requests return 403, authenticated requests succeed

**Day 4 — Patch the CVE**
- Identify the vulnerable package version and find the patched version
- Update the dependency, rebuild the image with a versioned tag
- Run Trivy scan against the new image, confirm CVE is gone
- Deploy as a new Cloud Run revision, use traffic splitting to validate before full rollout
- Monitor logs and error rates for 30 minutes after full cutover

**Day 5 — Prevent Recurrence & Close the Loop**
- Deploy org policy blocking allUsers across the organization
- Add Wiz CLI scan step to the Cloud Run CI/CD pipeline
- Create Wiz automation rule for future allUsers detections
- Enable Artifact Registry continuous vulnerability scanning
- Write the postmortem: root cause, timeline, prevention actions
- Close the Wiz finding with resolution notes and evidence

---

## 1. Investigation Approach

### Validating the Finding

Wiz findings are generally reliable, but they can occasionally reflect stale state — especially IAM policy snapshots that haven't synced after a recent change. Before escalating or remediating, I'd verify everything directly in GCP.

First, confirm the service is actually publicly reachable:

```bash
gcloud run services describe api-service-prod \
  --region=us-central1 \
  --project=prod-services \
  --format=json | jq '.metadata.annotations["run.googleapis.com/ingress"]'
```

If the value comes back as "all", the service is fully internet-exposed with no authentication required to hit its endpoints. I'd follow that up with a quick unauthenticated curl to confirm:

```bash
curl -I https://api-service-prod-<hash>-uc.a.run.app/health
```

A 200 OK with no Authorization header confirms the finding is real.

Then confirm the IAM binding:

```bash
gcloud run services get-iam-policy api-service-prod \
  --region=us-central1 \
  --project=prod-services \
  --format=json | jq '.bindings'
```

I'm looking specifically for allUsers bound to roles/run.invoker. It's worth noting the distinction — allUsers means literally anyone on the internet, no Google account required. That's categorically different from allAuthenticatedUsers, which at least requires a Google identity. Neither is acceptable for a service that handles PHI, but allUsers is the worst-case scenario.

Finally, confirm CVE-2025-15467 is present and exploitable in this specific image:

```bash
gcloud artifacts docker images describe <image-uri> \
  --show-package-vulnerability \
  --format=json | jq '.packageVulnerabilityDetails[]'
```

A CVSS score alone doesn't tell me enough. I need to know whether the vulnerable component is actively loaded at runtime or whether it's a transitive dependency that's never actually called. An exploitable vulnerability in a running code path is a completely different risk profile from the same CVE sitting in an unused library.

### Additional Logs and Information to Gather

**Who has actually been calling this service, and from where:**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="api-service-prod"' \
  --project=prod-services \
  --freshness=14d \
  --format=json | jq '.[].httpRequest.remoteIp' | sort | uniq -c | sort -rn
```

This is one of the most telling data points in the whole investigation. If I see traffic coming from three known internal IPs and nothing else, the automation claim starts to look credible. If I see traffic from dozens of different IPs, scanners, or known threat actor ranges, we have active exposure and the conversation changes completely.

**Who added allUsers to the policy, and when:**

```bash
gcloud logging read \
  'protoPayload.methodName="google.iam.v1.IAMPolicy.SetIamPolicy"
   AND protoPayload.resourceName:"api-service-prod"' \
  --project=prod-services \
  --freshness=90d \
  --format=json | jq '{who: .[].protoPayload.authenticationInfo.principalEmail, when: .[].timestamp}'
```

Was this a deliberate architectural decision, or did a developer add it six months ago as a quick fix that was never revisited? The audit log answers that question with facts, not assumptions.

**What data the service account can actually reach:**

```bash
SA=$(gcloud run services describe api-service-prod \
  --format='value(spec.template.spec.serviceAccountName)')
gcloud projects get-iam-policy prod-services \
  --flatten="bindings[].members" \
  --filter="bindings.members:$SA" \
  --format="table(bindings.role)"
```

In a healthcare context this matters enormously. If the service account attached to api-service-prod has access to MRI scan results, radiology reports, or biomarker panels — and an attacker exploits CVE-2025-15467 to get code execution — they inherit every permission that service account holds. That's the real blast radius, and it determines whether this is a critical incident response or a controlled remediation.

### Actual Risk vs. Intentional Exception

The application team's claim that this configuration is "needed for internal automation" needs to be validated with evidence, not accepted at face value. I'd approach that conversation directly but without accusation:

> *"Can you walk me through which systems are calling this service? If I look at the request logs and see exactly the IPs or service accounts you'd expect, that tells me something. If I see a much broader range of traffic, that tells me something different."*

The questions I'd ask in writing, so the answers are on record:
- Which specific systems call this service? Names, IPs, or service accounts.
- Why does the automation require allUsers rather than authenticating with a service account?
- When was this configuration put in place, and was it reviewed by anyone?
- What would break if we required authentication?

The reason allUsers almost never holds up as a legitimate requirement for internal automation is simple: GCP provides native, frictionless service-to-service authentication using OIDC tokens. Internal services don't need allUsers — they need a service account with invoker permissions, which is a five-minute change. If the team can't explain why that approach wouldn't work for them, the claim doesn't hold.

---

## 2. Remediation Plan

### Immediate Actions — Day 1

Before anything else, I'd communicate with the engineering team lead. Not a ticket, not an email — a Slack message:

> *"Hey — Wiz flagged api-service-prod with a critical finding. It's publicly accessible with allUsers on the invoker role, and it touches PHI data. I want to understand your automation setup before making any changes, but I'd also like to move on this today. Can we jump on a quick call? I have a drop-in alternative ready that shouldn't break your workflows."*

Then, once aligned with the team, remove allUsers from the invoker role:

```bash
gcloud run services remove-iam-policy-binding api-service-prod \
  --region=us-central1 \
  --project=prod-services \
  --member="allUsers" \
  --role="roles/run.invoker"
```

And restrict ingress to internal only:

```bash
gcloud run services update api-service-prod \
  --region=us-central1 \
  --project=prod-services \
  --ingress=internal
```

These two changes together eliminate the unauthenticated internet exposure immediately. The CVE is still present in the image, but without a public attack surface, exploitability drops significantly while we prepare the patch.

### Secure Alternative to allUsers: roles/run.invoker

The right pattern for internal service-to-service authentication in GCP is OIDC token-based auth with a dedicated service account per caller. This is natively supported by Cloud Run — no infrastructure changes, no proxy, no VPN required.

Create a dedicated service account for the automation caller:

```bash
gcloud iam service-accounts create automation-invoker-sa \
  --display-name="Automation SA for api-service-prod" \
  --project=prod-services

gcloud run services add-iam-policy-binding api-service-prod \
  --region=us-central1 \
  --member="serviceAccount:automation-invoker-sa@prod-services.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

The calling service fetches an OIDC token and attaches it to every request:

```python
import google.auth.transport.requests
import google.oauth2.id_token
import requests

def call_api_service(endpoint: str):
    audience = "https://api-service-prod-<hash>-uc.a.run.app"
    auth_req = google.auth.transport.requests.Request()
    token = google.oauth2.id_token.fetch_id_token(auth_req, audience)
    response = requests.get(
        f"{audience}/{endpoint}",
        headers={"Authorization": f"Bearer {token}"}
    )
    return response
```

Cloud Run validates the token automatically. The automation team gets a working, authenticated replacement for their current unauthenticated calls, and the attack surface is gone.

### If the Service Must Remain Publicly Accessible

If there's a genuine business requirement for public access — for example, if external partners or the member portal calls this service directly — the configuration changes but the security controls don't disappear. Put a Cloud Load Balancer in front. Never expose Cloud Run directly to the internet.

```bash
# Set ingress to allow load balancer traffic
gcloud run services update api-service-prod \
  --ingress=internal-and-cloud-load-balancing

# Create a serverless NEG
gcloud compute network-endpoint-groups create api-service-prod-neg \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=api-service-prod
```

Attach Cloud Armor for WAF protection:

```bash
gcloud compute security-policies create api-prod-waf-policy
gcloud compute security-policies rules create 1000 \
  --security-policy=api-prod-waf-policy \
  --expression="evaluatePreconfiguredExpr('owasp-crs-v030301-id944240-java')" \
  --action=deny-403
```

The layered approach — load balancer + Cloud Armor + IAP + application-level auth — means an attacker has to defeat multiple independent controls, not just one.

### Patching CVE-2025-15467 — Within the Sprint

```bash
# Rebuild with a versioned tag
gcloud builds submit \
  --tag gcr.io/prod-services/api-service-prod:patched-$(date +%Y%m%d) \
  --project=prod-services

# Verify clean before deploying
trivy image gcr.io/prod-services/api-service-prod:patched-$(date +%Y%m%d) \
  --severity CRITICAL --exit-code 1

# Deploy the patched revision
gcloud run deploy api-service-prod \
  --image=gcr.io/prod-services/api-service-prod:patched-$(date +%Y%m%d) \
  --region=us-central1 --project=prod-services
```

### Verifying the Fix — SDET Perspective

As a Senior SDET, deploying a fix isn't the finish line — verifying the fix actually works is. After every remediation step I'd run a structured set of checks to confirm the controls are enforced, not just configured.

After removing allUsers and restricting ingress:

```bash
# Test 1: Unauthenticated request must be rejected
curl -s -o /dev/null -w "%{http_code}" \
  https://api-service-prod-<hash>-uc.a.run.app/health
# Expected: 403 — NOT 200

# Test 2: Authenticated request with valid token must succeed
TOKEN=$(gcloud auth print-identity-token)
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  https://api-service-prod-<hash>-uc.a.run.app/health
# Expected: 200

# Test 3: Request from outside GCP must be blocked
# Run from a machine outside the GCP project — should timeout or return connection refused
```

After OIDC service account auth is configured:
- Confirm automation calls succeed end-to-end using the new service account
- Confirm requests with an incorrect or expired token return 401
- Confirm a service account without the invoker role returns 403
- Confirm no regression in the automation workflow — response payloads should be identical to before

After the CVE patch is deployed:
- Run Trivy against the deployed image digest, confirm CVE-2025-15467 is not present
- Run smoke tests against all major endpoints, confirm no functional regression from the dependency update
- Monitor Cloud Run error rate metrics for 30 minutes post-deployment

Finding the vulnerability and writing the fix is one skill — proving the fix holds under real conditions without breaking anything else is another. Both matter equally.

---

## 3. Prevention and Long-Term Controls

### Org Policy — Make allUsers Impossible at the Organization Level

The most durable control is one that doesn't rely on people following a process:

```bash
gcloud org-policies set-policy - <<EOF
name: organizations/<org-id>/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - values:
      allowedValues:
      - "C<customer-id>"  # Ezra's Google Workspace domain only
EOF
```

Once this is in place, any attempt to grant allUsers or allAuthenticatedUsers on any resource in the org is rejected by GCP before it takes effect. No process, no code review, no tribal knowledge required — the platform enforces it automatically.

### CI/CD Guardrails — Catch It Before It Reaches Prod

Add a Wiz CLI scan step to the Cloud Run deployment pipeline so a misconfigured service never gets deployed in the first place:

```yaml
# cloudbuild.yaml
steps:
  - name: 'wizsecurity/wizcli'
    id: 'security-scan'
    args: ['iac', 'scan', '--path', '.', '--policy', 'no-public-cloud-run-invoker']

  - name: 'gcr.io/cloud-builders/gcloud'
    id: 'deploy'
    args: ['run', 'deploy', 'api-service-prod', '...']
    waitFor: ['security-scan']
```

Any Terraform or deployment config that would grant allUsers fails the pipeline before it reaches any environment. Engineers get immediate, clear feedback on why — and what to use instead.

### Wiz Automation Rules

In the Wiz console, I'd create an automation rule:
- **Trigger:** Any Cloud Run service in prod-services where allUsers is bound to any invoker role
- **Action:** Create a P1 Jira ticket assigned to the service owner
- **Action:** Post to #security-alerts Slack with service name, project, and link to finding
- **Action:** Send email notification to the security team

The goal is detection within minutes, not weeks. If the org policy is somehow bypassed or a new environment gets created without it, this rule catches it immediately.

### Automated Security Regression Tests — SDET Contribution

One thing I'd bring to this role that a pure security engineer might not is a suite of automated regression tests that continuously verify security controls are actually enforced. These run in the CI/CD pipeline on every deployment — not just once after a fix.

```typescript
// security/cloud-run-auth.spec.ts

describe('api-service-prod authentication controls', () => {

  it('rejects unauthenticated requests with 403', async () => {
    const res = await fetch(SERVICE_URL + '/health');
    expect(res.status).toBe(403);
  });

  it('accepts requests with valid invoker service account token', async () => {
    const token = await getOidcToken(SERVICE_URL);
    const res = await fetch(SERVICE_URL + '/health', {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('rejects requests with an invalid token with 401', async () => {
    const res = await fetch(SERVICE_URL + '/health', {
      headers: { Authorization: 'Bearer invalid-token-here' }
    });
    expect(res.status).toBe(401);
  });

  it('does not expose PHI in unauthenticated error responses', async () => {
    const res = await fetch(SERVICE_URL + '/api/patient-data');
    const body = await res.text();
    expect(body).not.toMatch(/ssn|dob|diagnosis|mrn/i);
  });
});
```

If a future change accidentally re-introduces allUsers or breaks the auth middleware, the pipeline fails before it reaches prod — with a clear error pointing to the specific test. This turns a one-time fix into a permanent, continuously enforced control.

### Continuous Vulnerability Scanning

Enable Artifact Registry's continuous vulnerability scanning so CVEs are surfaced when images are pushed, not after they've been running in production for months:

```bash
gcloud services enable containerscanning.googleapis.com --project=prod-services
```

SLA expectations I'd propose to the team:
- **Critical CVE:** 24 hours to remediate or document a compensating control
- **High CVE:** 7 days
- **Medium CVE:** next sprint

---

## 4. Cross-Team Collaboration

### Communicating the Finding

I wouldn't lead with severity levels or acronyms. I'd lead with the business risk, in plain language, in a channel the engineering team actually reads.

**Initial Slack message to the engineering lead:**

> *"Hey — Wiz flagged api-service-prod as publicly accessible with no authentication required. Since this service has access to patient data, I want to get this addressed today. I've already looked at the logs and I have a fix ready that shouldn't break your automation. Can we spend 15 minutes together so I can understand your setup and we can move on this quickly?"*

**Follow-up in the engineering channel:**

> *"FYI — we're making a change to api-service-prod's IAM config today as part of addressing a Wiz finding. If you have automation that calls this service, please reach out so we can make sure it keeps working after the change."*

### Balancing Risk Reduction with Developer Autonomy

In a fast-moving startup, security that slows engineering down doesn't get followed — it gets worked around. My approach:

- **Bring the solution, not just the problem.** When I flag allUsers, I hand the team a working OIDC code snippet so the migration lift is minimal. The secure path should be the easy path.
- **Set firm but fair timelines.** For a critical finding touching PHI: IAM change within 24 hours, CVE patch within 7 days. I'd hold those lines but work actively with the team to meet them.
- **Don't make security a gate.** I'd rather be in the room during architecture discussions than reviewing a finished design after the fact. Early involvement prevents these situations more effectively than reactive enforcement.

### What "Done" Looks Like

Done isn't the Wiz ticket being marked resolved. Done is:

- allUsers removed from roles/run.invoker — confirmed in live GCP policy
- Service ingress restricted or protected behind a load balancer
- Verification test confirms unauthenticated requests return 403, not 200
- CVE-2025-15467 patched, Trivy scan confirms clean on deployed image
- Internal automation confirmed working end-to-end with service account OIDC auth
- Smoke tests pass in production after CVE patch deployment
- Automated security regression test suite added to CI/CD pipeline
- Org policy deployed blocking future allUsers grants at the org level
- Wiz automation rule live — future occurrences trigger immediate alerts
- Short postmortem written: root cause, timeline, prevention actions
- Wiz finding status: Resolved and verified

---

## Reflection

My experience as a Senior SDET at Oak Street Health, a primary care provider serving Medicare patients, directly shapes how I'd approach this finding. Working daily with systems that process sensitive patient data made it clear early on that a misconfiguration is never just a technical issue — in healthcare, it's a potential patient harm event and a regulatory liability. During one sprint, while validating a third-party medication integration, I noticed through Grafana log analysis that API responses were occasionally returning patient medication records without authentication checks being enforced on the receiving end. The integration was passing data correctly, but the downstream service wasn't validating auth headers under certain race conditions. Rather than logging a defect and moving on, I brought it directly to the developer and the product owner together, framed it around what patient data could be exposed and to whom, and we prioritized a hotfix within the same sprint. That experience shaped how I handle anything touching auth or data exposure — treat it as a cross-functional conversation, not a ticket, and always come with a proposed fix already in hand. At Ezra, where MRI results and biomarker data are the core of the product, I'd bring exactly that instinct: move fast on exposure, communicate clearly across teams, and leave the system better instrumented so the same gap can't quietly reappear.
