import Image from "next/image";
import { teamMembers } from "@/lib/site";

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
              <Image src={member.image} alt={member.name} width={480} height={480} />
              <h3>{member.name}</h3>
              <p>{member.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
