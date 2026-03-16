"use client";

import Image from "next/image";
import { useState } from "react";

type PosterItem = {
  title: string;
  image: string;
  alt: string;
  href?: string;
};

const posterItems: PosterItem[] = [
  {
    title: "Open Tournament Winners",
    image: "/images/openwinners.jpg",
    alt: "Open Tournament Winners",
  },
  {
    title: "Open Tournament 2nd Place",
    image: "/images/open2place.jpg",
    alt: "Open Tournament 2nd Place",
  },
  {
    title: "Open Tournament 3rd Place",
    image: "/images/open3place.jpg",
    alt: "Open Tournament 3rd Place",
  },
  {
    title: "Appreciation Post",
    image: "/images/appreciationpost.jpg",
    alt: "Appreciation Post",
    href: "https://www.facebook.com/share/p/171tYjHPh5/",
  },
  {
    title: "Open Tournament Poster",
    image: "/images/openposter.jpg",
    alt: "Open Tournament Poster",
  },
  {
    title: "Open Tournament Finals",
    image: "/images/openfinals.jpg",
    alt: "Open Tournament Finals",
  },
  {
    title: "Open Tournament Semi Finals 2",
    image: "/images/opensemis2.jpg",
    alt: "Open Tournament Semi Finals 2",
  },
  {
    title: "Open Tournament Semi Finals 1",
    image: "/images/opensemis1.jpg",
    alt: "Open Tournament Semi Finals 1",
  },
  {
    title: "Open Tournament Brackets",
    image: "/images/openbrackets.jpg",
    alt: "Open Tournament Brackets",
  },
  {
    title: "Women's Tournament Winners",
    image: "/images/womenswinners.jpg",
    alt: "Women's Tournament Winners",
  },
  {
    title: "Women's Tournament 2nd Place",
    image: "/images/womens2place.jpg",
    alt: "Women's Tournament 2nd Place",
  },
  {
    title: "Women's Tournament Brackets",
    image: "/images/womensbrackets.jpg",
    alt: "Women's Tournament Brackets",
  },
  {
    title: "Women's Tournament Poster",
    image: "/images/womensposter.jpg",
    alt: "Women's Tournament Poster",
  },
  {
    title: "Women's Prize Pool",
    image: "/images/womensprizepool.jpg",
    alt: "Women's Prize Pool",
  },
  {
    title: "Women's Semi Finals 2",
    image: "/images/semi2womens.jpg",
    alt: "Women's Semi Finals 2",
  },
  {
    title: "Women's Semi Finals 1",
    image: "/images/semi1womens.jpg",
    alt: "Women's Semi Finals 1",
  },
  {
    title: "Women's Tournament Summary",
    image: "/images/summarywomens.jpg",
    alt: "Women's Tournament Summary",
  },
];

export default function PostersContent() {
  const [selectedImage, setSelectedImage] = useState<PosterItem | null>(null);

  return (
    <>
      <section className="gallery-section">
        <div className="container">
          <div className="gallery-grid">
            {/* Items with external links behave like outbound cards; the rest open in the local lightbox. */}
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
        // Clicking the backdrop closes the lightbox, while clicks inside the content stay open.
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
