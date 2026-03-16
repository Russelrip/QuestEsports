"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/auth";

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
  const { login } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState<LoginFormData>(initialFormData);

  // A single handler updates both text inputs and the remember-me checkbox.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // Login creates a server session cookie and returns the signed-in user payload.
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);

    if (!formData.emailOrUsername || !formData.password) {
      setError("Please enter your username/email and password.");
      return;
    }

    try {
      const res = await apiFetch("/api/login", {
        method: "POST",
        json: {
          emailOrUsername: formData.emailOrUsername,
          password: formData.password,
          remember: formData.remember,
        },
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Login failed.");
        return;
      }

      login(data.user);

      setSubmitted(true);
      setFormData(initialFormData);
      router.push(data.user.role === "admin" ? "/admin" : "/profile");

      console.log("Login successful:", data.user);
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
                onChange={handleChange}
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
                onChange={handleChange}
              />
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  name="remember"
                  checked={formData.remember}
                  onChange={handleChange}
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
            <a href="#">Forgot Password?</a> |{" "}
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
