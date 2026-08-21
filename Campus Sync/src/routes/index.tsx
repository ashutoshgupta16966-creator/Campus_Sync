import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  GraduationCap,
  LayoutDashboard,
  Sparkles,
  Users,
  FileCheck2,
  Activity,
  FileText,
  Trophy,
  MessageSquare,
  UploadCloud,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Summarizer } from "@/components/campus/Summarizer";
import { Matcher } from "@/components/campus/Matcher";
import { AtsChecker } from "@/components/campus/AtsChecker";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CampusSync — AI Study, Teammate & Resume Toolkit" },
      {
        name: "description",
        content:
          "CampusSync turns lecture notes into exam-ready summaries, matches you with hackathon teammates, and scores your resume against ATS filters.",
      },
      { property: "og:title", content: "CampusSync — AI Study, Teammate & Resume Toolkit" },
      {
        property: "og:description",
        content:
          "Summarize notes, find hackathon teammates and check your ATS resume score — all in one campus workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "summarizer", label: "AI Summarizer", icon: Sparkles },
  { id: "matcher", label: "Teammate Matcher", icon: Users },
  { id: "ats", label: "ATS Checker", icon: FileCheck2 },
] as const;

type TabId = (typeof tabs)[number]["id"];

const activity = [
  {
    icon: FileText,
    who: "Deepak Verma",
    text: "added notes for DBMS Unit-2",
    time: "2 mins ago",
  },
  {
    icon: Trophy,
    who: "Rohan Iyer",
    text: "created a hackathon team for Smart India Hackathon",
    time: "10 mins ago",
  },
  {
    icon: UploadCloud,
    who: "Priya Gupta",
    text: "uploaded a resume and scored 82 / 100 on the ATS check",
    time: "26 mins ago",
  },
  {
    icon: Sparkles,
    who: "Ananya Rao",
    text: "summarized 3 Operating Systems lectures",
    time: "1 hour ago",
  },
  {
    icon: MessageSquare,
    who: "Aarav Sharma",
    text: "is looking for a backend dev for HackFest '26",
    time: "3 hours ago",
  },
];

function Dashboard({ go }: { go: (t: TabId) => void }) {

  const cards = [
    {
      id: "summarizer" as const,
      icon: Sparkles,
      title: "AI Notes Summarizer",
      body: "Turn a 90-minute lecture into key takeaways, formulas and likely exam questions.",
      stat: "12 summaries this week",
    },
    {
      id: "matcher" as const,
      icon: Users,
      title: "Teammate & Hackathon Matcher",
      body: "Filter classmates by skill and send invites for your next build weekend.",
      stat: "6 teammates available",
    },
    {
      id: "ats" as const,
      icon: FileCheck2,
      title: "Resume & ATS Score Checker",
      body: "See how recruiter software reads your resume before a human ever does.",
      stat: "Real-time ATS content scanner",
    },
  ];
  return (
    <div className="space-y-8">
      <section className="glass relative overflow-hidden rounded-3xl p-8 sm:p-12">
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-primary/25 blur-3xl" />
        <p className="text-xs uppercase tracking-[0.3em] text-primary-glow">Semester workspace</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">
          Everything you need to <span className="text-gradient">study, team up and get hired</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
          One workspace for your notes, your hackathon squad and your resume — no tab-hopping, no
          setup.
        </p>
        <button
          onClick={() => go("summarizer")}
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary to-primary-glow px-6 py-3 text-sm font-semibold text-primary-foreground glow-ring transition hover:opacity-90"
        >
          <Sparkles className="size-4" /> Summarize today's lecture
        </button>
      </section>

      <section className="glass rounded-3xl p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Activity className="size-5 text-primary-glow" /> Campus Activity Feed
          </h2>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-success" /> Live
          </span>
        </div>
        <ul className="mt-5 divide-y divide-border">
          {activity.map((a) => (
            <li key={a.text} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary-glow">
                <a.icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{a.who}</span>{" "}
                  <span className="text-muted-foreground">{a.text}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.time}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>



      <div className="grid gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.id}
            onClick={() => go(c.id)}
            className="glass group rounded-3xl p-6 text-left transition hover:border-primary/50"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary-glow">
              <c.icon className="size-5" />
            </div>
            <h2 className="mt-4 font-semibold">{c.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            <p className="mt-4 text-xs uppercase tracking-wide text-primary-glow">{c.stat}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function Index() {
  const [tab, setTab] = useState<TabId>("dashboard");

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-linear-to-b from-primary/15 to-transparent" />
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary-glow text-primary-foreground glow-ring">
              <GraduationCap className="size-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">CampusSync</span>
          </div>

          <nav className="hidden items-center gap-1 lg:flex">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "rounded-full px-4 py-2 text-sm font-medium transition " +
                  (tab === t.id
                    ? "bg-primary/20 text-primary-glow"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">Ashutosh Gupta</p>
              <p className="text-xs text-muted-foreground">CSE · 2nd Year</p>
            </div>
            <div className="flex size-9 items-center justify-center rounded-full bg-linear-to-br from-primary to-primary-glow text-sm font-semibold text-primary-foreground">
              AG
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden">
          <div className="flex gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition " +
                  (tab === t.id
                    ? "bg-primary/20 text-primary-glow"
                    : "border border-border text-muted-foreground")
                }
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        {tab === "dashboard" && <Dashboard go={setTab} />}
        {tab === "summarizer" && <Summarizer />}
        {tab === "matcher" && <Matcher />}
        {tab === "ats" && <AtsChecker />}
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        CampusSync · built for students who ship
      </footer>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!bg-card !text-card-foreground !border-border !rounded-2xl",
            description: "!text-muted-foreground",
            icon: "!text-primary-glow",
          },
        }}
      />
    </div>
  );
}
