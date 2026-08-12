import { SignIn } from "@clerk/tanstack-react-start";

export function LoginForm() {
  return (
    <div className="flex justify-center">
      {/* Splat-mounted (login.$.tsx): Clerk owns /login/* for its internal
          steps (factor-one, create/sso-callback on OAuth sign-up transfer). */}
      <SignIn path="/login" fallbackRedirectUrl="/" signUpUrl="/login" />
    </div>
  );
}
