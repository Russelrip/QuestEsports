const teamMembers = [
  {
    name: "Sahan Jayasuriya",
    role: "Owner",
    image: "/images/sahan.jpg",
  },
  {
    name: "Senumi Ekanayake",
    role: "Owner / Founder",
    image: "/images/senumi.jpg",
  },
  {
    name: "Russel Perera",
    role: "Director / Co-Owner",
    image: "/images/russel.jpg",
  },
  {
    name: "Deshika Peiris",
    role: "Head Admin",
    image: "/images/deshika.jpg",
  },
];

export default function TeamSection() {
  return (
    <section className="team-section">
      <div className="container">
        <h2>Meet the Quest Esports Team</h2>
        <p className="section-intro">
          Passionate esports enthusiasts building tournaments and community
          experiences.
        </p>

        <div className="team-grid">
          {teamMembers.map((member) => (
            <div className="team-member" key={member.name}>
              <img src={member.image} alt={member.name} />
              <h3>{member.name}</h3>
              <p>{member.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
