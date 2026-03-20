"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFormFields } from "@/hooks/useFormFields";
import { apiFetchJson, AuthUser, getApiErrorMessage } from "@/lib/auth";

type LoginFormData = {
  emailOrUsername: string;
  password: string;
  remember: boolean;
};

const initialFormData: LoginFormData = {
  emailOrUsername: "",
  password: "",
  remember: false,
};

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const {
    fields: formData,
    handleFieldChange,
    resetFields,
  } = useFormFields<LoginFormData>(initialFormData);

  const redirectTo = searchParams.get("redirect");
  const nextPath =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);

    if (!formData.emailOrUsername || !formData.password) {
      setError("Please enter your username/email and password.");
      return;
    }

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user: AuthUser;
      }>("/api/login", {
        method: "POST",
        json: {
          emailOrUsername: formData.emailOrUsername,
          password: formData.password,
          remember: formData.remember,
        },
      });

      const errorMessage = getApiErrorMessage(response, data, "Login failed.");
      if (errorMessage) {
        setError(errorMessage);
        return;
      }

      login(data.user);

      setSubmitted(true);
      resetFields();
      router.push(nextPath || (data.user.role === "admin" ? "/admin" : "/profile"));
    } catch (err) {
      console.error("Login error:", err);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section className="login-section">
      <div className="form-container login-container">
        <div className="login-box">
          <h2>Player Login</h2>

          <form id="loginForm" className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="emailOrUsername">Email or Username *</label>
              <input
                type="text"
                id="emailOrUsername"
                name="emailOrUsername"
                required
                value={formData.emailOrUsername}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password *</label>
              <input
                type="password"
                id="password"
                name="password"
                required
                value={formData.password}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  name="remember"
                  checked={formData.remember}
                  onChange={handleFieldChange}
                />{" "}
                Remember me
              </label>
            </div>

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="btn btn-primary">
              Login
            </button>
          </form>

          <p className="form-footer">
            <Link href="/forgot-password">Forgot Password?</Link> |{" "}
            <Link href="/signup">Register Account</Link>
          </p>
        </div>

        {submitted && (
          <div id="loginSuccess" className="success-message">
            <h3>Login Successful!</h3>
            <p>Welcome back! You can now access your account.</p>
          </div>
        )}
      </div>
    </section>
  );
}
