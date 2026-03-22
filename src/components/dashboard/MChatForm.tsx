// ECD Intelligence Platform — M-CHAT-R/F Screening Form
// Modified Checklist for Autism in Toddlers, Revised with Follow-Up
// Age-gated: only renders for children aged 16–30 months
// Offline-capable, bilingual (English + Telugu)

import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Send,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MChatFormProps {
  childAgeMonths: number;
  childId: string;
  onComplete: (result: MChatResult) => void;
}

interface MChatResult {
  itemResponses: Record<number, boolean>;
  totalScore: number;
  criticalFails: number;
  riskLevel: "Low" | "Medium" | "High";
  followupRequired: boolean;
  autismRiskMapping: "Low" | "Moderate" | "High";
}

interface MChatItem {
  id: number;
  critical: boolean;
  q_en: string;
  q_te: string;
}

// ─── M-CHAT-R Item Definitions (all 20) ───────────────────────────────────────

const MCHAT_ITEMS: MChatItem[] = [
  {
    id: 1,
    critical: true,
    q_en: "If you point at something across the room, does your child look at it?",
    q_te: "మీరు గదిలో ఏదైనా చూపిస్తే, మీ పిల్లవాడు దాన్ని చూస్తాడా?",
  },
  {
    id: 2,
    critical: false,
    q_en: "Have you ever wondered if your child might be deaf?",
    q_te: "మీ పిల్లవాడు చెవిటివాడేమో అని ఎప్పుడైనా అనిపించిందా?",
  },
  {
    id: 3,
    critical: true,
    q_en: "Does your child play pretend or make-believe?",
    q_te: "మీ పిల్లవాడు నటించే ఆటలు ఆడతాడా?",
  },
  {
    id: 4,
    critical: false,
    q_en: "Does your child like climbing on things?",
    q_te: "మీ పిల్లవాడు వస్తువులపై ఎక్కడం ఇష్టపడతాడా?",
  },
  {
    id: 5,
    critical: false,
    q_en: "Does your child make unusual finger movements near his/her eyes?",
    q_te: "మీ పిల్లవాడు కళ్ళ దగ్గర వేళ్ళను అసాధారణంగా కదిలిస్తాడా?",
  },
  {
    id: 6,
    critical: true,
    q_en: "Does your child point with one finger to ask for something or get help?",
    q_te: "మీ పిల్లవాడు ఏదైనా అడగడానికి ఒక వేలుతో చూపిస్తాడా?",
  },
  {
    id: 7,
    critical: true,
    q_en: "Does your child point with one finger to show you something interesting?",
    q_te: "మీ పిల్లవాడు ఆసక్తికరమైన దాన్ని చూపించడానికి ఒక వేలుతో చూపిస్తాడా?",
  },
  {
    id: 8,
    critical: false,
    q_en: "Is your child interested in other children?",
    q_te: "మీ పిల్లవాడు ఇతర పిల్లలపై ఆసక్తి కలిగి ఉంటాడా?",
  },
  {
    id: 9,
    critical: true,
    q_en: "Does your child show you things by bringing them to you or holding them up for you to see?",
    q_te: "మీ పిల్లవాడు వస్తువులను మీకు చూపించడానికి తీసుకొస్తాడా?",
  },
  {
    id: 10,
    critical: false,
    q_en: "Does your child respond to his/her name when you call?",
    q_te: "మీరు పేరు పిలిచినప్పుడు మీ పిల్లవాడు స్పందిస్తాడా?",
  },
  {
    id: 11,
    critical: false,
    q_en: "When you smile at your child, does he/she smile back at you?",
    q_te: "మీరు నవ్విన తర్వాత మీ పిల్లవాడు నవ్వుతాడా?",
  },
  {
    id: 12,
    critical: false,
    q_en: "Does your child get upset by everyday noises?",
    q_te: "రోజువారీ శబ్దాలకు మీ పిల్లవాడు ఇబ్బంది పడతాడా?",
  },
  {
    id: 13,
    critical: true,
    q_en: "Does your child walk?",
    q_te: "మీ పిల్లవాడు నడుస్తాడా?",
  },
  {
    id: 14,
    critical: false,
    q_en: "Does your child look you in the eye when you are talking to him/her?",
    q_te: "మీరు మాట్లాడేటప్పుడు మీ పిల్లవాడు మీ కళ్ళలోకి చూస్తాడా?",
  },
  {
    id: 15,
    critical: false,
    q_en: "Does your child try to copy what you do?",
    q_te: "మీరు చేసే పనులను మీ పిల్లవాడు అనుకరించడానికి ప్రయత్నిస్తాడా?",
  },
  {
    id: 16,
    critical: false,
    q_en: "If you turn your head to look at something, does your child look around to see what you are looking at?",
    q_te: "మీరు ఏదైనా చూడడానికి తల తిప్పితే, మీ పిల్లవాడు కూడా చూస్తాడా?",
  },
  {
    id: 17,
    critical: false,
    q_en: "Does your child try to get you to watch him/her?",
    q_te: "మీ పిల్లవాడు మిమ్మల్ని తనను చూడమని ప్రయత్నిస్తాడా?",
  },
  {
    id: 18,
    critical: false,
    q_en: "Does your child understand when you tell him/her to do something?",
    q_te: "మీరు ఏదైనా చేయమని చెప్పినప్పుడు మీ పిల్లవాడు అర్థం చేసుకుంటాడా?",
  },
  {
    id: 19,
    critical: false,
    q_en: "If something new happens, does your child look at your face to see how you feel about it?",
    q_te: "కొత్తది జరిగినప్పుడు మీ పిల్లవాడు మీ ముఖం చూస్తాడా?",
  },
  {
    id: 20,
    critical: false,
    q_en: "Does your child like movement activities?",
    q_te: "మీ పిల్లవాడు కదలిక కార్యకలాపాలను ఇష్టపడతాడా?",
  },
];

// Items where YES = fail (at-risk)
const FAIL_ON_YES = new Set([2, 5, 12]);
// Items where NO = fail (at-risk) — all the rest
const FAIL_ON_NO = new Set([1, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20]);
// Critical items
const CRITICAL_ITEM_IDS = new Set([1, 3, 6, 7, 9, 13]);

// ─── Scoring Logic ────────────────────────────────────────────────────────────

function isItemFailed(itemId: number, answer: boolean): boolean {
  // answer: true = YES, false = NO
  if (FAIL_ON_YES.has(itemId)) return answer === true;
  if (FAIL_ON_NO.has(itemId)) return answer === false;
  return false;
}

function computeResult(responses: Record<number, boolean>): MChatResult {
  let totalScore = 0;
  let criticalFails = 0;

  for (const item of MCHAT_ITEMS) {
    const answer = responses[item.id];
    if (answer === undefined) continue;
    const failed = isItemFailed(item.id, answer);
    if (failed) {
      totalScore++;
      if (CRITICAL_ITEM_IDS.has(item.id)) {
        criticalFails++;
      }
    }
  }

  // Determine risk level per M-CHAT-R protocol
  let riskLevel: "Low" | "Medium" | "High";
  if (totalScore >= 8) {
    riskLevel = "High";
  } else if (totalScore >= 3) {
    riskLevel = "Medium";
  } else {
    riskLevel = "Low";
  }

  // Critical items override: if 2+ critical items failed, minimum risk = Medium
  if (criticalFails >= 2 && riskLevel === "Low") {
    riskLevel = "Medium";
  }

  const followupRequired = riskLevel === "Medium" || riskLevel === "High";

  const autismRiskMapping: "Low" | "Moderate" | "High" =
    riskLevel === "Low" ? "Low" : riskLevel === "Medium" ? "Moderate" : "High";

  return {
    itemResponses: { ...responses },
    totalScore,
    criticalFails,
    riskLevel,
    followupRequired,
    autismRiskMapping,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const MChatForm: React.FC<MChatFormProps> = ({
  childAgeMonths,
  childId,
  onComplete,
}) => {
  const { t, i18n } = useTranslation();
  const [responses, setResponses] = useState<Record<number, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<MChatResult | null>(null);

  // Age gate: only 16–30 months
  if (childAgeMonths < 16 || childAgeMonths > 30) {
    return null;
  }

  const answeredCount = Object.keys(responses).length;
  const totalItems = MCHAT_ITEMS.length;
  const allAnswered = answeredCount === totalItems;
  const progressPercent = Math.round((answeredCount / totalItems) * 100);

  const isTelugu = i18n.language === "te";

  const handleAnswer = (itemId: number, answer: boolean) => {
    if (submitted) return;
    setResponses((prev) => ({ ...prev, [itemId]: answer }));
  };

  const handleSubmit = () => {
    if (!allAnswered) return;
    const res = computeResult(responses);
    setResult(res);
    setSubmitted(true);
    onComplete(res);
  };

  const handleReset = () => {
    setResponses({});
    setSubmitted(false);
    setResult(null);
  };

  // ─── Risk badge rendering ──────────────────────────────────────────────────

  const riskBadge = (level: "Low" | "Medium" | "High") => {
    const config = {
      Low: {
        color: "bg-green-100 text-green-800 border-green-300",
        icon: <ShieldCheck className="w-5 h-5" />,
        label: isTelugu ? "తక్కువ ప్రమాదం" : "Low Risk",
      },
      Medium: {
        color: "bg-amber-100 text-amber-800 border-amber-300",
        icon: <AlertTriangle className="w-5 h-5" />,
        label: isTelugu ? "మధ్యస్థ ప్రమాదం" : "Medium Risk",
      },
      High: {
        color: "bg-red-100 text-red-800 border-red-300",
        icon: <ShieldAlert className="w-5 h-5" />,
        label: isTelugu ? "అధిక ప్రమాదం" : "High Risk",
      },
    };
    const c = config[level];
    return (
      <span
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-lg font-semibold ${c.color}`}
      >
        {c.icon}
        {c.label}
      </span>
    );
  };

  // ─── Result Summary ────────────────────────────────────────────────────────

  if (submitted && result) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            {isTelugu ? "M-CHAT-R/F ఫలితాలు" : "M-CHAT-R/F Results"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center gap-4">
            {riskBadge(result.riskLevel)}

            <div className="text-center space-y-2 mt-4">
              <p className="text-lg">
                <span className="font-semibold">
                  {isTelugu ? "మొత్తం స్కోర్:" : "Total Score:"}
                </span>{" "}
                {result.totalScore} / {totalItems}
              </p>
              <p className="text-lg">
                <span className="font-semibold">
                  {isTelugu
                    ? "క్రిటికల్ ఐటమ్‌ల వైఫల్యాలు:"
                    : "Critical Item Fails:"}
                </span>{" "}
                {result.criticalFails} / {CRITICAL_ITEM_IDS.size}
              </p>
              {result.followupRequired && (
                <div className="flex items-center justify-center gap-2 mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <span className="text-amber-800 font-medium">
                    {isTelugu
                      ? "ఫాలో-అప్ అవసరం"
                      : "Follow-up assessment required"}
                  </span>
                </div>
              )}
              {!result.followupRequired && (
                <div className="flex items-center justify-center gap-2 mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-green-800 font-medium">
                    {isTelugu
                      ? "ఫాలో-అప్ అవసరం లేదు"
                      : "No follow-up required"}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4">
            <Button
              onClick={handleReset}
              variant="outline"
              className="w-full min-h-[48px] text-base"
            >
              {isTelugu ? "మళ్ళీ చేయండి" : "Retake Screening"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Questionnaire ─────────────────────────────────────────────────────────

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-center">
          {isTelugu
            ? "M-CHAT-R/F ఆటిజం స్క్రీనింగ్"
            : "M-CHAT-R/F Autism Screening"}
        </CardTitle>
        <p className="text-sm text-muted-foreground text-center mt-1">
          {isTelugu
            ? `పిల్లల వయస్సు: ${childAgeMonths} నెలలు | ID: ${childId}`
            : `Child age: ${childAgeMonths} months | ID: ${childId}`}
        </p>
        <div className="mt-3">
          <Progress value={progressPercent} className="h-2" />
          <p className="text-xs text-muted-foreground text-center mt-1">
            {answeredCount} / {totalItems}{" "}
            {isTelugu ? "సమాధానాలు" : "answered"}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {MCHAT_ITEMS.map((item) => {
          const answered = responses[item.id] !== undefined;
          const currentAnswer = responses[item.id];

          return (
            <div
              key={item.id}
              className={`rounded-lg border p-4 transition-colors ${
                answered
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-card"
              }`}
            >
              {/* Question text */}
              <div className="mb-3">
                <div className="flex items-start gap-2">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold">
                    {item.id}
                  </span>
                  <div className="flex-1">
                    <p className="text-base font-medium leading-snug">
                      {item.q_en}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">
                      {item.q_te}
                    </p>
                  </div>
                  {item.critical && (
                    <Badge
                      variant="outline"
                      className="flex-shrink-0 text-xs border-orange-300 text-orange-600 bg-orange-50"
                    >
                      {isTelugu ? "క్రిటికల్" : "Critical"}
                    </Badge>
                  )}
                </div>
              </div>

              {/* YES / NO toggle buttons — 48dp minimum tap target */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleAnswer(item.id, true)}
                  className={`flex-1 min-h-[48px] rounded-lg border-2 text-base font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                    currentAnswer === true
                      ? "border-green-500 bg-green-100 text-green-800"
                      : "border-gray-200 bg-white text-gray-600 hover:border-green-300 hover:bg-green-50"
                  }`}
                  aria-pressed={currentAnswer === true}
                  aria-label={`Question ${item.id}: Yes`}
                >
                  {isTelugu ? "అవును" : "YES"}
                </button>
                <button
                  type="button"
                  onClick={() => handleAnswer(item.id, false)}
                  className={`flex-1 min-h-[48px] rounded-lg border-2 text-base font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                    currentAnswer === false
                      ? "border-red-500 bg-red-100 text-red-800"
                      : "border-gray-200 bg-white text-gray-600 hover:border-red-300 hover:bg-red-50"
                  }`}
                  aria-pressed={currentAnswer === false}
                  aria-label={`Question ${item.id}: No`}
                >
                  {isTelugu ? "కాదు" : "NO"}
                </button>
              </div>
            </div>
          );
        })}

        {/* Submit button */}
        <div className="pt-4">
          <Button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="w-full min-h-[48px] text-lg font-semibold"
          >
            <Send className="w-5 h-5 mr-2" />
            {isTelugu ? "స్క్రీనింగ్ సమర్పించండి" : "Submit Screening"}
          </Button>
          {!allAnswered && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {isTelugu
                ? `దయచేసి అన్ని ${totalItems} ప్రశ్నలకు సమాధానం ఇవ్వండి`
                : `Please answer all ${totalItems} questions to submit`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default MChatForm;
