import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, UserPlus, Check, Target } from "lucide-react";

const SKILLS = ["React", "Python", "AI/ML", "UI/UX", "Web3", "DevOps", "SQL", "Figma"] as const;

type Student = {
  id: number;
  name: string;
  branch: string;
  skills: string[];
  lookingFor: string;
  initials: string;
};

const students: Student[] = [
  {
    id: 1,
    name: "Aarav Sharma",
    branch: "CS · 3rd Year",
    skills: ["React", "Python"],
    lookingFor: "Backend dev for hackathon.",
    initials: "AS",
  },
  {
    id: 2,
    name: "Priya Gupta",
    branch: "IT · 2nd Year",
    skills: ["UI/UX", "Figma"],
    lookingFor: "Design projects with a shipping team.",
    initials: "PG",
  },
  {
    id: 3,
    name: "Rohan Iyer",
    branch: "CS · 4th Year",
    skills: ["AI/ML", "Python"],
    lookingFor: "Teammate for a computer-vision hackathon.",
    initials: "RI",
  },
  {
    id: 4,
    name: "Sara Khan",
    branch: "ECE · 3rd Year",
    skills: ["DevOps", "SQL"],
    lookingFor: "Frontend partner to ship an internal tool.",
    initials: "SK",
  },
  {
    id: 5,
    name: "Dev Patel",
    branch: "IT · 2nd Year",
    skills: ["Web3", "React"],
    lookingFor: "Smart-contract mentor for an ETH build weekend.",
    initials: "DP",
  },
  {
    id: 6,
    name: "Ananya Rao",
    branch: "CS · 4th Year",
    skills: ["SQL", "Python", "AI/ML"],
    lookingFor: "Data analyst for a campus analytics project.",
    initials: "AR",
  },
];

export function Matcher() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string[]>([]);
  const [invited, setInvited] = useState<number[]>([]);

  const toggle = (skill: string) =>
    setActive((s) => (s.includes(skill) ? s.filter((x) => x !== skill) : [...s, skill]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      const matchQ =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q) ||
        s.lookingFor.toLowerCase().includes(q) ||
        s.skills.some((k) => k.toLowerCase().includes(q));
      const matchS = active.length === 0 || active.every((k) => s.skills.includes(k));
      return matchQ && matchS;
    });
  }, [query, active]);

  const invite = (s: Student) => {
    if (invited.includes(s.id)) return;
    setInvited((prev) => [...prev, s.id]);
    toast.success(`Invite sent to ${s.name}`, { description: "They'll get a ping on CampusSync." });
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-3xl p-5 sm:p-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, branch, skill or what they're looking for…"
            className="w-full rounded-full border border-border bg-secondary/40 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {SKILLS.map((skill) => {
            const on = active.includes(skill);
            return (
              <button
                key={skill}
                onClick={() => toggle(skill)}
                className={
                  on
                    ? "rounded-full bg-linear-to-r from-primary to-primary-glow px-4 py-1.5 text-xs font-semibold text-primary-foreground glow-ring"
                    : "rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                }
              >
                {skill}
              </button>
            );
          })}
          {(active.length > 0 || query) && (
            <button
              onClick={() => {
                setActive([]);
                setQuery("");
              }}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Showing {filtered.length} of {students.length} students
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">
          No teammates match those filters yet.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const sent = invited.includes(s.id);
            return (
              <article key={s.id} className="glass flex flex-col rounded-3xl p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-primary-glow text-sm font-bold text-primary-foreground">
                    {s.initials}
                  </div>
                  <div>
                    <h3 className="font-semibold leading-tight">{s.name}</h3>
                    <p className="text-xs text-muted-foreground">{s.branch}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {s.skills.map((k) => (
                    <span
                      key={k}
                      className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-xs font-medium text-primary-glow"
                    >
                      {k}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex gap-2 text-sm text-muted-foreground">
                  <Target className="mt-0.5 size-4 shrink-0 text-accent" />
                  <p>
                    <span className="font-medium text-foreground">Looking for: </span>
                    {s.lookingFor}
                  </p>
                </div>
                <button
                  onClick={() => invite(s)}
                  disabled={sent}
                  className={
                    sent
                      ? "mt-6 inline-flex items-center justify-center gap-2 rounded-full border border-success/40 bg-success/15 px-4 py-2.5 text-sm font-semibold text-success"
                      : "mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-linear-to-r from-primary to-primary-glow px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                  }
                >
                  {sent ? <Check className="size-4" /> : <UserPlus className="size-4" />}
                  {sent ? "Sent ✔️" : "Send Invite"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
