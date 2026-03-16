"use client";

import Image from "next/image";
import { useState } from "react";
import { posterItems, type PosterItem } from "@/lib/media";

export default function PostersContent() {
  const [selectedImage, setSelectedImage] = useState<PosterItem | null>(null);

  return (
    <>
      <section className="gallery-section">
        <div className="container">
          <div className="gallery-grid">
            {posterItems.map((item) =>
              item.href ? (
                <a
                  key={item.title}
                  className="gallery-item"
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Image src={item.image} alt={item.alt} width={800} height={520} />
                  <div className="gallery-overlay">
                    <h3>{item.title}</h3>
                  </div>
                </a>
              ) : (
                <button
                  key={item.title}
                  type="button"
                  className="gallery-item gallery-popup-item"
                  onClick={() => setSelectedImage(item)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <Image src={item.image} alt={item.alt} width={800} height={520} />
                  <div className="gallery-overlay">
                    <h3>{item.title}</h3>
                  </div>
                </button>
              )
            )}
          </div>
        </div>
      </section>

      {selectedImage && (
        <div
          id="galleryPopup"
          className="gallery-popup active"
          onClick={() => setSelectedImage(null)}
        >
          <span
            className="gallery-popup-close"
            onClick={() => setSelectedImage(null)}
          >
            &times;
          </span>

          <div
            className="gallery-popup-content"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              id="galleryPopupImg"
              src={selectedImage.image}
              alt={selectedImage.alt}
              width={1400}
              height={900}
            />
            <p id="galleryPopupCaption">{selectedImage.title}</p>
          </div>
        </div>
      )}
    </>
  );
}
