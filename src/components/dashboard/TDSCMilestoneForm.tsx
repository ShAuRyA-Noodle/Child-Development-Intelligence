// ECD Intelligence Platform — TDSC Milestone Assessment Form
// Implements the Trivandrum Development Screening Chart (TDSC)
// All 20 items embedded with age-normed 90th percentile values
// Works 100% offline — no external data dependencies

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Baby, Hand, MessageCircle, Heart,
  CheckCircle2, AlertTriangle, Save,
  ChevronRight, ChevronLeft, XCircle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TDSCMilestoneFormProps {
  childAgeMonths: number;
  childId: string;
  onComplete: (results: TDSCResult) => void;
}

interface TDSCResult {
  responses: Record<string, boolean>;
  domainDQs: { gm: number; fm: number; lc: number; se: number };
  delayFlags: { gm_delay: number; fm_delay: number; lc_delay: number; se_delay: number };
  numDelays: number;
}

interface TDSCItem {
  id: string;
  label_en: string;
  label_te: string;
  label_hi: string;
  p90_months: number;
}

interface TDSCDomain {
  key: "gm" | "fm" | "lc" | "se";
  label_en: string;
  label_te: string;
  label_hi: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  items: TDSCItem[];
}

// ─── TDSC Data (all 20 items embedded) ──────────────────────────────────────

const TDSC_DOMAINS: TDSCDomain[] = [
  {
    key: "gm",
    label_en: "Gross Motor",
    label_te: "స్థూల మోటార్",
    label_hi: "स्थूल मोटर",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/40",
    borderColor: "border-blue-200 dark:border-blue-800",
    icon: <Baby className="w-5 h-5" />,
    items: [
      { id: "gm1", label_en: "Holds head steady when held sitting", label_te: "కూర్చున్నప్పుడు తల స్థిరంగా ఉంచడం", label_hi: "बैठे हुए सिर स्थिर रखना", p90_months: 4 },
      { id: "gm2", label_en: "Rolls over", label_te: "దొర్లడం", label_hi: "करवट लेना", p90_months: 5 },
      { id: "gm3", label_en: "Sits without support", label_te: "మద్దతు లేకుండా కూర్చోవడం", label_hi: "बिना सहारे बैठना", p90_months: 9 },
      { id: "gm4", label_en: "Stands holding on", label_te: "పట్టుకుని నిలబడడం", label_hi: "पकड़कर खड़ा होना", p90_months: 10 },
      { id: "gm5", label_en: "Walks alone", label_te: "ఒంటరిగా నడవడం", label_hi: "अकेले चलना", p90_months: 14 },
      { id: "gm6", label_en: "Runs", label_te: "పరుగెత్తడం", label_hi: "दौड़ना", p90_months: 18 },
    ],
  },
  {
    key: "fm",
    label_en: "Fine Motor",
    label_te: "సూక్ష్మ మోటార్",
    label_hi: "सूक्ष्म मोटर",
    color: "text-emerald-700 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/40",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    icon: <Hand className="w-5 h-5" />,
    items: [
      { id: "fm1", label_en: "Reaches for object", label_te: "వస్తువు వైపు చేయి చాచడం", label_hi: "वस्तु की ओर हाथ बढ़ाना", p90_months: 5 },
      { id: "fm2", label_en: "Transfers object hand to hand", label_te: "వస్తువు ఒక చేతి నుండి మరొక చేతికి బదిలీ", label_hi: "एक हाथ से दूसरे हाथ में वस्तु देना", p90_months: 7 },
      { id: "fm3", label_en: "Pincer grasp", label_te: "చిటికెన వేలు పట్టుకోవడం", label_hi: "चुटकी पकड़", p90_months: 10 },
      { id: "fm4", label_en: "Scribbles spontaneously", label_te: "స్వయంచాలకంగా గీయడం", label_hi: "अपने आप लिखना", p90_months: 15 },
      { id: "fm5", label_en: "Tower of 3 cubes", label_te: "3 చతురస్రాల బురుజు", label_hi: "3 घनों का टावर", p90_months: 20 },
    ],
  },
  {
    key: "lc",
    label_en: "Language / Communication",
    label_te: "భాష / సంభాషణ",
    label_hi: "भाषा / संचार",
    color: "text-violet-700 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/40",
    borderColor: "border-violet-200 dark:border-violet-800",
    icon: <MessageCircle className="w-5 h-5" />,
    items: [
      { id: "lc1", label_en: "Vocalises — not crying", label_te: "ఏడవకుండా శబ్దాలు చేయడం", label_hi: "बिना रोए आवाज़ निकालना", p90_months: 2 },
      { id: "lc2", label_en: "Turns to voice", label_te: "గొంతుకు తిరగడం", label_hi: "आवाज़ की ओर मुड़ना", p90_months: 4 },
      { id: "lc3", label_en: "Says mama/dada nonspecifically", label_te: "అమ్మ/నాన్న అనడం", label_hi: "मामा/दादा कहना", p90_months: 9 },
      { id: "lc4", label_en: "Says 3 words with meaning", label_te: "అర్థంతో 3 పదాలు చెప్పడం", label_hi: "अर्थ के साथ 3 शब्द", p90_months: 14 },
      { id: "lc5", label_en: "2-word phrases", label_te: "2 పద వాక్యాలు", label_hi: "2 शब्द के वाक्य", p90_months: 24 },
    ],
  },
  {
    key: "se",
    label_en: "Social-Emotional",
    label_te: "సామాజిక-భావోద్వేగ",
    label_hi: "सामाजिक-भावनात्मक",
    color: "text-rose-700 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-950/40",
    borderColor: "border-rose-200 dark:border-rose-800",
    icon: <Heart className="w-5 h-5" />,
    items: [
      { id: "se1", label_en: "Smiles responsively", label_te: "స్పందనగా నవ్వడం", label_hi: "जवाब में मुस्कुराना", p90_months: 3 },
      { id: "se2", label_en: "Plays peek-a-boo", label_te: "దాగుడుమూతలు ఆడడం", label_hi: "लुका-छिपी खेलना", p90_months: 10 },
      { id: "se3", label_en: "Imitates activities", label_te: "కార్యకలాపాలను అనుకరించడం", label_hi: "गतिविधियों की नकल", p90_months: 15 },
      { id: "se4", label_en: "Parallel play", label_te: "సమాంతర ఆట", label_hi: "समानांतर खेल", p90_months: 24 },
    ],
  },
];

// ─── IndexedDB helpers ──────────────────────────────────────────────────────

const DB_NAME = "tdsc_assessments";
const STORE_NAME = "responses";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "childId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToIndexedDB(childId: string, data: Record<string, boolean>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      childId,
      responses: data,
      updatedAt: Date.now(),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback to localStorage
    window.localStorage.setItem(
      `tdsc_${childId}`,
      JSON.stringify({ responses: data, updatedAt: Date.now() })
    );
  }
}

async function loadFromIndexedDB(childId: string): Promise<Record<string, boolean> | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(childId);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result?.responses ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    // Fallback to localStorage
    const raw = window.localStorage.getItem(`tdsc_${childId}`);
    if (raw) {
      try {
        return JSON.parse(raw).responses;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TDSCMilestoneForm({
  childAgeMonths,
  childId,
  onComplete,
}: TDSCMilestoneFormProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [activeDomainIdx, setActiveDomainIdx] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedRef = useRef<string>("");

  const currentLang = i18n.language?.startsWith("te")
    ? "te"
    : i18n.language?.startsWith("hi")
      ? "hi"
      : "en";

  // ── Determine age-appropriate items per domain ────────────────────────────

  const visibleDomains = useMemo(() => {
    return TDSC_DOMAINS.map((domain) => ({
      ...domain,
      items: domain.items.filter((item) => item.p90_months <= childAgeMonths + 3),
    })).filter((domain) => domain.items.length > 0);
  }, [childAgeMonths]);

  // ── Load saved responses on mount ─────────────────────────────────────────

  useEffect(() => {
    loadFromIndexedDB(childId).then((saved) => {
      if (saved) {
        setResponses(saved);
      }
      setIsLoaded(true);
    });
  }, [childId]);

  // ── Auto-save every 30s ───────────────────────────────────────────────────

  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      const snapshot = JSON.stringify(responses);
      if (snapshot !== lastSavedRef.current && Object.keys(responses).length > 0) {
        saveToIndexedDB(childId, responses);
        lastSavedRef.current = snapshot;
      }
    }, 30_000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [childId, responses]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggle = useCallback((itemId: string, value: boolean) => {
    setResponses((prev) => ({ ...prev, [itemId]: value }));
  }, []);

  const handleManualSave = useCallback(async () => {
    await saveToIndexedDB(childId, responses);
    lastSavedRef.current = JSON.stringify(responses);
    toast({
      title: currentLang === "te" ? "సేవ్ చేయబడింది" : currentLang === "hi" ? "सहेजा गया" : "Saved",
      description:
        currentLang === "te"
          ? "ప్రతిస్పందనలు స్థానికంగా సేవ్ చేయబడ్డాయి"
          : currentLang === "hi"
            ? "प्रतिक्रियाएं स्थानीय रूप से सहेजी गईं"
            : "Responses saved locally",
    });
  }, [childId, responses, toast, currentLang]);

  // ── DQ computation ────────────────────────────────────────────────────────

  const computeResults = useCallback((): TDSCResult => {
    const domainDQs = { gm: 0, fm: 0, lc: 0, se: 0 };
    const delayFlags = { gm_delay: 0, fm_delay: 0, lc_delay: 0, se_delay: 0 };

    for (const domain of TDSC_DOMAINS) {
      const key = domain.key as keyof typeof domainDQs;
      const delayKey = `${key}_delay` as keyof typeof delayFlags;

      // Find highest achieved milestone p90 age in this domain
      let highestAchievedP90 = 0;
      for (const item of domain.items) {
        if (responses[item.id] === true) {
          highestAchievedP90 = Math.max(highestAchievedP90, item.p90_months);
        }
      }

      // DQ = (developmental_age / chronological_age) * 100
      const dq =
        highestAchievedP90 > 0 && childAgeMonths > 0
          ? Math.round((highestAchievedP90 / childAgeMonths) * 100)
          : 0;

      domainDQs[key] = dq;

      // Delay flag: count items past p90 that are NOT achieved
      let delayCount = 0;
      for (const item of domain.items) {
        if (item.p90_months <= childAgeMonths && responses[item.id] !== true) {
          delayCount++;
        }
      }
      delayFlags[delayKey] = delayCount;
    }

    const numDelays = Object.values(delayFlags).filter((d) => d > 0).length;

    return { responses, domainDQs, delayFlags, numDelays };
  }, [responses, childAgeMonths]);

  const handleSubmit = useCallback(async () => {
    await saveToIndexedDB(childId, responses);
    const results = computeResults();
    onComplete(results);
  }, [childId, responses, computeResults, onComplete]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getItemLabel = (item: TDSCItem): string => {
    if (currentLang === "te") return item.label_te;
    if (currentLang === "hi") return item.label_hi;
    return item.label_en;
  };

  const getDomainLabel = (domain: TDSCDomain): string => {
    if (currentLang === "te") return domain.label_te;
    if (currentLang === "hi") return domain.label_hi;
    return domain.label_en;
  };

  const isItemDelayed = (item: TDSCItem): boolean => {
    return item.p90_months <= childAgeMonths && responses[item.id] !== true;
  };

  // ── Progress calculation ──────────────────────────────────────────────────

  const totalItems = visibleDomains.reduce((sum, d) => sum + d.items.length, 0);
  const answeredItems = visibleDomains.reduce(
    (sum, d) => sum + d.items.filter((item) => responses[item.id] !== undefined).length,
    0
  );
  const progressPct = totalItems > 0 ? Math.round((answeredItems / totalItems) * 100) : 0;

  const activeDomain = visibleDomains[activeDomainIdx];

  if (!isLoaded) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-pulse text-muted-foreground">Loading assessment...</div>
        </CardContent>
      </Card>
    );
  }

  if (visibleDomains.length === 0) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">No age-appropriate TDSC items for this child.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto border border-border shadow-sm">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">
            {currentLang === "te"
              ? "TDSC అభివృద్ధి మూల్యాంకనం"
              : currentLang === "hi"
                ? "TDSC विकासात्मक मूल्यांकन"
                : "TDSC Developmental Assessment"}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSave}
            className="min-h-[48px] min-w-[48px] gap-2"
          >
            <Save className="w-4 h-4" />
            {currentLang === "te" ? "సేవ్" : currentLang === "hi" ? "सहेजें" : "Save"}
          </Button>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              {currentLang === "te"
                ? `పిల్లవాడి వయసు: ${childAgeMonths} నెలలు`
                : currentLang === "hi"
                  ? `बच्चे की उम्र: ${childAgeMonths} महीने`
                  : `Child age: ${childAgeMonths} months`}
            </span>
            <span>
              {answeredItems}/{totalItems}{" "}
              {currentLang === "te" ? "పూర్తయింది" : currentLang === "hi" ? "पूर्ण" : "completed"}
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      </CardHeader>

      <Separator />

      {/* ── Domain Tabs ────────────────────────────────────────────────────── */}
      <div className="flex overflow-x-auto border-b border-border">
        {visibleDomains.map((domain, idx) => {
          const domainAnswered = domain.items.filter(
            (item) => responses[item.id] !== undefined
          ).length;
          const domainHasDelay = domain.items.some((item) => isItemDelayed(item));
          const isActive = idx === activeDomainIdx;

          return (
            <button
              key={domain.key}
              onClick={() => setActiveDomainIdx(idx)}
              className={`
                flex items-center gap-2 px-4 py-3 min-h-[48px] text-sm font-medium
                whitespace-nowrap transition-colors border-b-2
                ${
                  isActive
                    ? `${domain.color} border-current`
                    : "text-muted-foreground border-transparent hover:text-foreground hover:border-border"
                }
              `}
            >
              {domain.icon}
              <span className="hidden sm:inline">{getDomainLabel(domain)}</span>
              <span className="text-xs text-muted-foreground">
                {domainAnswered}/{domain.items.length}
              </span>
              {domainHasDelay && responses[domain.items.find((i) => isItemDelayed(i))!.id] !== undefined && (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Milestone Items ────────────────────────────────────────────────── */}
      <CardContent className="py-4 space-y-3">
        <div className={`rounded-lg p-3 ${activeDomain.bgColor} ${activeDomain.borderColor} border`}>
          <h3 className={`text-sm font-semibold ${activeDomain.color} mb-1`}>
            {getDomainLabel(activeDomain)}
          </h3>
          <p className="text-xs text-muted-foreground">
            {currentLang === "te"
              ? "ప్రతి మైలురాయి సాధించారో లేదో సూచించండి"
              : currentLang === "hi"
                ? "प्रत्येक मील का पत्थर हासिल हुआ या नहीं बताएं"
                : "Indicate whether each milestone has been achieved"}
          </p>
        </div>

        {activeDomain.items.map((item) => {
          const achieved = responses[item.id];
          const delayed = isItemDelayed(item);
          const isPastP90 = item.p90_months <= childAgeMonths;
          const showAmber = isPastP90 && achieved !== true;

          return (
            <div
              key={item.id}
              className={`
                rounded-lg border p-4 transition-all
                ${
                  showAmber && achieved === false
                    ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30"
                    : achieved === true
                      ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20"
                      : "border-border bg-card"
                }
              `}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {getItemLabel(item)}
                  </p>
                  {currentLang !== "en" && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.label_en}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      p90: {item.p90_months}
                      {currentLang === "te" ? " నెలలు" : currentLang === "hi" ? " महीने" : "mo"}
                    </Badge>
                    {showAmber && achieved === false && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 dark:text-amber-400"
                      >
                        <AlertTriangle className="w-3 h-3 mr-0.5" />
                        {currentLang === "te"
                          ? "ఆలస్యం"
                          : currentLang === "hi"
                            ? "विलंब"
                            : "Delayed"}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* YES / NO toggle — 48dp minimum tap targets */}
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(item.id, true)}
                    className={`
                      min-w-[48px] min-h-[48px] rounded-lg flex flex-col items-center justify-center
                      text-xs font-semibold transition-all border-2
                      ${
                        achieved === true
                          ? "border-emerald-500 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-400 shadow-sm"
                          : "border-border bg-muted/30 text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                      }
                    `}
                    aria-label={`${item.label_en}: Yes`}
                  >
                    <CheckCircle2 className="w-5 h-5 mb-0.5" />
                    {currentLang === "te" ? "అవును" : currentLang === "hi" ? "हाँ" : "YES"}
                  </button>
                  <button
                    onClick={() => handleToggle(item.id, false)}
                    className={`
                      min-w-[48px] min-h-[48px] rounded-lg flex flex-col items-center justify-center
                      text-xs font-semibold transition-all border-2
                      ${
                        achieved === false
                          ? "border-red-400 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 dark:border-red-500 shadow-sm"
                          : "border-border bg-muted/30 text-muted-foreground hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
                      }
                    `}
                    aria-label={`${item.label_en}: No`}
                  >
                    <XCircle className="w-5 h-5 mb-0.5" />
                    {currentLang === "te" ? "కాదు" : currentLang === "hi" ? "नहीं" : "NO"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      <Separator />

      {/* ── Navigation + Submit ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActiveDomainIdx((prev) => Math.max(0, prev - 1))}
          disabled={activeDomainIdx === 0}
          className="min-h-[48px] gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          {currentLang === "te" ? "వెనుకకు" : currentLang === "hi" ? "पीछे" : "Previous"}
        </Button>

        {activeDomainIdx < visibleDomains.length - 1 ? (
          <Button
            onClick={() => setActiveDomainIdx((prev) => Math.min(visibleDomains.length - 1, prev + 1))}
            className="min-h-[48px] gap-1"
          >
            {currentLang === "te" ? "తదుపరి" : currentLang === "hi" ? "अगला" : "Next"}
            <ChevronRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={answeredItems < totalItems}
            className="min-h-[48px] gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <CheckCircle2 className="w-4 h-4" />
            {currentLang === "te"
              ? "సమర్పించండి"
              : currentLang === "hi"
                ? "जमा करें"
                : "Submit Assessment"}
          </Button>
        )}
      </div>

      {/* ── DQ Summary (shown when all answered) ───────────────────────────── */}
      {answeredItems === totalItems && totalItems > 0 && (
        <>
          <Separator />
          <CardContent className="py-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">
              {currentLang === "te"
                ? "DQ సారాంశం"
                : currentLang === "hi"
                  ? "DQ सारांश"
                  : "DQ Summary"}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {visibleDomains.map((domain) => {
                const key = domain.key as keyof TDSCResult["domainDQs"];
                const results = computeResults();
                const dq = results.domainDQs[key];
                const isLow = dq < 75;
                const isBorderline = dq >= 75 && dq < 85;

                return (
                  <div
                    key={domain.key}
                    className={`
                      rounded-lg border p-3 text-center
                      ${
                        isLow
                          ? "border-red-300 bg-red-50/50 dark:border-red-700 dark:bg-red-950/30"
                          : isBorderline
                            ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30"
                            : "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20"
                      }
                    `}
                  >
                    <p className={`text-xs font-medium ${domain.color}`}>
                      {getDomainLabel(domain)}
                    </p>
                    <p
                      className={`text-2xl font-bold mt-1 ${
                        isLow
                          ? "text-red-600 dark:text-red-400"
                          : isBorderline
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {dq}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">DQ</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
