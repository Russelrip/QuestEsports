(function () {
  "use strict";

  function show(el) {
    if (el) el.style.display = "block";
  }

  function hide(el) {
    if (el) el.style.display = "none";
  }

  // Registration form
  const registrationForm = document.getElementById("registrationForm");
  if (registrationForm) {
    registrationForm.addEventListener("submit", function (e) {
      e.preventDefault();

      hide(registrationForm);
      show(document.getElementById("successMessage"));

      setTimeout(() => {
        registrationForm.reset();
        show(registrationForm);
        hide(document.getElementById("successMessage"));
      }, 3000);
    });
  }

  // Tournament registration form
  const tournamentRegistrationForm = document.getElementById("tournamentRegistrationForm");
  if (tournamentRegistrationForm) {
    tournamentRegistrationForm.addEventListener("submit", function (e) {
      e.preventDefault();

      hide(tournamentRegistrationForm);
      show(document.getElementById("registrationSuccess"));

      setTimeout(() => {
        tournamentRegistrationForm.reset();
        show(tournamentRegistrationForm);
        hide(document.getElementById("registrationSuccess"));
      }, 3000);
    });
  }

  // Login form with admin demo login
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    const rememberBox = loginForm.querySelector('input[name="remember"]');
    const usernameField = document.getElementById("username");
    const passwordField = document.getElementById("password");

    if (usernameField && rememberBox) {
      const last = localStorage.getItem("lastUsername");
      if (last) {
        usernameField.value = last;
        rememberBox.checked = true;
      }
    }

    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const username = usernameField?.value.trim() || "";
      const password = passwordField?.value || "";
      const remember = !!rememberBox?.checked;

      if (remember) {
        localStorage.setItem("lastUsername", username);
      } else {
        localStorage.removeItem("lastUsername");
      }

      if (username === "admin" && password === "Bloodchaos2025@") {
        alert("Admin login successful!");
        window.location.href = "index.html";
        return;
      }

      hide(loginForm);
      show(document.getElementById("loginSuccess"));

      setTimeout(() => {
        window.location.href = "index.html";
      }, 1200);
    });
  }

  // Signup form
  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    signupForm.addEventListener("submit", function (e) {
      e.preventDefault();

      const password = document.getElementById("password")?.value || "";
      const confirmPassword = document.getElementById("confirmPassword")?.value || "";

      if (password !== confirmPassword) {
        alert("Passwords do not match!");
        return;
      }

      hide(signupForm);
      show(document.getElementById("signupSuccess"));

      setTimeout(() => {
        signupForm.reset();
        show(signupForm);
        hide(document.getElementById("signupSuccess"));
      }, 3000);
    });
  }

  // Contact form
  const contactForm = document.getElementById("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();

      hide(contactForm);
      show(document.getElementById("contactSuccess"));

      setTimeout(() => {
        contactForm.reset();
        show(contactForm);
        hide(document.getElementById("contactSuccess"));
      }, 3000);
    });
  }

  // Tournament filter
  const gameFilter = document.getElementById("gameFilter");
  if (gameFilter) {
    gameFilter.addEventListener("change", function () {
      const selectedGame = this.value;
      const items = document.querySelectorAll(".tournament-item");

      items.forEach((item) => {
        const game = item.getAttribute("data-game");

        if (selectedGame === "all") {
          item.style.display = "grid";
        } else if (game === selectedGame) {
          item.style.display = "grid";
        } else {
          item.style.display = "none";
        }
      });
    });
  }

  // Gallery popup
  const galleryPopup = document.getElementById("galleryPopup");
  const galleryPopupImg = document.getElementById("galleryPopupImg");
  const galleryPopupCaption = document.getElementById("galleryPopupCaption");
  const galleryPopupClose = document.querySelector(".gallery-popup-close");
  const galleryPopupItems = document.querySelectorAll(".gallery-popup-item");

  if (galleryPopup && galleryPopupImg && galleryPopupItems.length > 0) {
    galleryPopupItems.forEach((item) => {
      item.addEventListener("click", function () {
        const img = item.querySelector("img");
        const caption = item.querySelector(".gallery-overlay h3");

        if (img) {
          galleryPopupImg.src = img.src;
          galleryPopupImg.alt = img.alt || "Gallery Image";
          galleryPopupCaption.textContent = caption ? caption.textContent : img.alt;
          galleryPopup.classList.add("active");
          document.body.style.overflow = "hidden";
        }
      });
    });

    if (galleryPopupClose) {
      galleryPopupClose.addEventListener("click", function () {
        galleryPopup.classList.remove("active");
        document.body.style.overflow = "";
      });
    }

    galleryPopup.addEventListener("click", function (e) {
      if (e.target === galleryPopup) {
        galleryPopup.classList.remove("active");
        document.body.style.overflow = "";
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && galleryPopup.classList.contains("active")) {
        galleryPopup.classList.remove("active");
        document.body.style.overflow = "";
      }
    });
  }

  console.log("Quest Esports script loaded");
})();