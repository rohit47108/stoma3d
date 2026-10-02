import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getProductContext, productHomeForAccount } from "@/lib/product-auth";
import { hostedWorkspaceEnabled } from "@/lib/production-env";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  const workspaceEnabled = hostedWorkspaceEnabled();
  if (!workspaceEnabled) {
    return (
      <main className="signin-stage" id="main-content">
        <section className="signin-sheet" aria-labelledby="signin-title">
          <BrandMark />
          <div>
            <p className="workspace-kicker">Stoma3D</p>
            <h1 id="signin-title">Scan here, no account needed.</h1>
            <p>
              Take or upload mouth photos, review your results, and explore the
              3D map in your browser. Your scans stay on this device.
            </p>
            <p>Account sync isn’t enabled on this site yet.</p>
          </div>
          <Link className="button" href="/scan">
            Open your scans
          </Link>
          <Link className="text-link" href="/">
            Back to Stoma3D
          </Link>
        </section>
        <aside className="signin-context" aria-label="What Stoma3D includes">
          <p className="workspace-kicker">Your scan</p>
          <dl>
            <div>
              <dt>Eight-region scan</dt>
              <dd>Capture the same complete set of mouth views each time.</dd>
            </div>
            <div>
              <dt>Observation history</dt>
              <dd>Open saved photos and observations by date and region.</dd>
            </div>
            <div>
              <dt>Portable report</dt>
              <dd>Save or print a report with your photos and results.</dd>
            </div>
          </dl>
          <strong>This result is not a diagnosis.</strong>
        </aside>
      </main>
    );
  }
  const context = await getProductContext();
  if (context.state === "ready")
    redirect(productHomeForAccount(context.account));
  if (context.state === "service_unavailable") redirect("/app");

  return (
    <main className="signin-stage" id="main-content">
      <section className="signin-sheet" aria-labelledby="signin-title">
        <BrandMark />
        <div>
          <p className="workspace-kicker">Private workspace</p>
          <h1 id="signin-title">Your observations, under your control.</h1>
          <p>
            Sign in to open the scans and reports saved to your account. You can
            also scan without an account in your browser or the Stoma3D mobile
            app.
          </p>
        </div>
        <a className="button" href="/auth/login?returnTo=%2Fapp">
          Continue to secure sign in
        </a>
        <p className="signin-sheet__note">
          Stoma3D uses an encrypted session cookie. Health images and results
          are not stored in your sign-in profile.
        </p>
        <Link className="text-link" href="/scan">
          Continue without an account
        </Link>
        <Link className="text-link" href="/">
          Back to Stoma3D
        </Link>
      </section>
      <aside className="signin-context" aria-label="What this account opens">
        <p className="workspace-kicker">After sign in</p>
        <dl>
          <div>
            <dt>Patients</dt>
            <dd>Open scans and reports that belong to your account.</dd>
          </div>
          <div>
            <dt>Clinicians</dt>
            <dd>Review only records a patient has shared with you.</dd>
          </div>
          <div>
            <dt>Shared viewers</dt>
            <dd>Open only the time-limited record named by a share link.</dd>
          </div>
        </dl>
        <strong>This result is not a diagnosis.</strong>
      </aside>
    </main>
  );
}
