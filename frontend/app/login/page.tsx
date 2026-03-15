"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type LoginFormData = {
  emailOrUsername: string;
  password: string;
  remember: boolean;
};

export default function LoginPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState<LoginFormData>({
    emailOrUsername: "",
    password: "",
    remember: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);

    if (!formData.emailOrUsername || !formData.password) {
      setError("Please enter your username/email and password.");
      return;
    }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emailOrUsername: formData.emailOrUsername,
          password: formData.password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Login failed.");
        return;
      }

      if (formData.remember) {
        localStorage.setItem("questUser", JSON.stringify(data.user));
      } else {
        sessionStorage.setItem("questUser", JSON.stringify(data.user));
      }

      setSubmitted(true);
      setFormData({
        emailOrUsername: "",
        password: "",
        remember: false,
      });

      console.log("Login successful:", data.user);
    } catch (err) {
      console.error("Login error:", err);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <>
      <section className="page-header">
        <h1>Login</h1>
        <p>Access your Quest Esports account</p>
      </section>

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
    </>
  );
}