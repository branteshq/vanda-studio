"use client";

import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

export function AuthStatus() {
  const { isLoaded, isSignedIn, user } = useUser();

  return (
    <section className="auth-panel">
      <div>
        <span className="eyebrow">Authentication</span>
        {!isLoaded ? <p>Checking Clerk session...</p> : null}
        {isLoaded && isSignedIn ? (
          <p>
            Signed in as <strong>{user?.primaryEmailAddress?.emailAddress ?? user?.username ?? user?.id}</strong>
          </p>
        ) : null}
        {isLoaded && !isSignedIn ? <p>Sign in to let Vanda read your existing Instagram projects and posts from Convex.</p> : null}
      </div>

      {isLoaded && isSignedIn ? (
        <UserButton />
      ) : null}
      {isLoaded && !isSignedIn ? (
        <SignInButton mode="modal">
          <button className="auth-button" type="button">
            Sign in
          </button>
        </SignInButton>
      ) : null}
    </section>
  );
}
