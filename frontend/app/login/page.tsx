"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type LoginFormData = {
  username: string;
  password: string;
  remember: boolean;
};

export default function LoginPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState<LoginFormData>({
    username: "",
    password: "",
    remember: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;

    if (type === "checkbox") {
      setFormData((prev) => ({
        ...prev,
        [name]: e.target.checked,
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);

    if (!formData.username || !formData.password) {
      setError("Please enter your username/email and password.");
      return;
    }

    console.log("Login submitted:", formData);
    setSubmitted(true);
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
                <label htmlFor="username">Email or Username *</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  required
                  value={formData.username}
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
              Admin login: <strong>admin</strong> /{" "}
              <strong>Bloodchaos2025@</strong>
            </p>

            <p className="form-footer">
              <a href="#">Forgot Password?</a> |{" "}
              <Link href="/signup">Register Account</Link>
            </p>
          </div>

          {submitted && (
            <div id="loginSuccess" className="success-message">
              <h3>Login Successful!</h3>
              <p>Welcome back! You will be redirected shortly.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}