import { useUser } from "@clerk/tanstack-react-start";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { LoginForm } from "../components/login-form";
import { OrchidAperture } from "../components/orchid-aperture";
import { VandaMark } from "../components/vanda-mark";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { isSignedIn } = useUser();

  if (isSignedIn) {
    return <Navigate to="/" />;
  }

  return (
    <div className="flex min-h-svh overflow-hidden bg-app text-text antialiased">
      <div className="relative flex w-full shrink-0 flex-col border-r border-border px-6 py-[46px] sm:px-14 lg:w-[47%] lg:max-w-[720px]">
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-[380px] max-w-full">
            <div className="mb-9 flex flex-col items-center text-center">
              <div className="mb-[22px]">
                <VandaMark size={40} />
              </div>
              <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em]">
                Entrar na sua conta
              </h1>
            </div>

            <LoginForm />
          </div>
        </div>
      </div>

      <div className="relative hidden flex-1 items-center justify-center overflow-hidden bg-inset lg:flex">
        <div className="relative z-10 size-[540px] max-w-[80%]">
          <OrchidAperture />
        </div>
      </div>
    </div>
  );
}
