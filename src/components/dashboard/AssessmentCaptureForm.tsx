// ECD Intelligence Platform — Assessment Capture Form
// Offline-capable form for AWWs to capture developmental assessments
// Designed for low-literacy users: large tap targets, icon-driven, vernacular

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { dataService } from "@/services/dataService";
import {
  ClipboardCheck, Baby, Brain, Hand, MessageCircle,
  Heart, Ruler, Weight, CheckCircle2, AlertTriangle,
  ChevronRight, ChevronLeft, Save, Wifi, WifiOff,
} from "lucide-react";
import { isOnline } from "@/lib/apiClient";

// ─── Milestone Definitions ──────────────────────────────────────────────────

interface Milestone {
  id: string;
  label: string;
  label_te: string; // Telugu
  label_hi: string; // Hindi
  icon: string;
  ageMonths: [number, number]; // [min, max] expected age range
}

interface DomainConfig {
  key: string;
  label: string;
  label_te: string;
  label_hi: string;
  color: string;
  icon: React.ReactNode;
  milestones: Milestone[];
}

const DOMAINS: DomainConfig[] = [
  {
    key: "gross_motor",
    label: "Gross Motor",
    label_te: "స్థూల మోటార్",
    label_hi: "स्थूल मोटर",
    color: "bg-blue-500",
    icon: <Baby className="w-6 h-6" />,
    milestones: [
      { id: "gm_head_control", label: "Holds head steady", label_te: "తల నిలబెట్టగలరు", label_hi: "सिर स्थिर रखता है", icon: "head", ageMonths: [2, 4] },
      { id: "gm_rolls", label: "Rolls over", label_te: "పక్కకు తిరుగుతారు", label_hi: "करवट लेता है", icon: "roll", ageMonths: [3, 6] },
      { id: "gm_sits", label: "Sits without support", label_te: "ఆసరా లేకుండా కూర్చుంటారు", label_hi: "बिना सहारे बैठता है", icon: "sit", ageMonths: [5, 8] },
      { id: "gm_crawls", label: "Crawls", label_te: "ఊరుగుతారు", label_hi: "रेंगता है", icon: "crawl", ageMonths: [6, 10] },
      { id: "gm_stands", label: "Stands with support", label_te: "ఆసరాతో నిలబడతారు", label_hi: "सहारे से खड़ा होता है", icon: "stand", ageMonths: [8, 12] },
      { id: "gm_walks", label: "Walks independently", label_te: "స్వతంత్రంగా నడుస్తారు", label_hi: "अकेले चलता है", icon: "walk", ageMonths: [10, 18] },
      { id: "gm_runs", label: "Runs", label_te: "పరుగెత్తుతారు", label_hi: "दौड़ता है", icon: "run", ageMonths: [14, 24] },
      { id: "gm_jumps", label: "Jumps with both feet", label_te: "రెండు కాళ్ళతో దూకుతారు", label_hi: "दोनों पैरों से कूदता है", icon: "jump", ageMonths: [22, 36] },
    ],
  },
  {
    key: "fine_motor",
    label: "Fine Motor",
    label_te: "సూక్ష్మ మోటార్",
    label_hi: "सूक्ष्म मोटर",
    color: "bg-green-500",
    icon: <Hand className="w-6 h-6" />,
    milestones: [
      { id: "fm_grasps", label: "Grasps objects", label_te: "వస్తువులను పట్టుకుంటారు", label_hi: "वस्तुएँ पकड़ता है", icon: "grasp", ageMonths: [3, 5] },
      { id: "fm_transfers", label: "Transfers hand to hand", label_te: "ఒక చేతి నుండి మరొక చేతికి", label_hi: "हाथ से हाथ पकड़ता है", icon: "transfer", ageMonths: [5, 8] },
      { id: "fm_pincer", label: "Pincer grasp", label_te: "చిటికిన పట్టు", label_hi: "चुटकी से पकड़ता है", icon: "pincer", ageMonths: [8, 12] },
      { id: "fm_scribbles", label: "Scribbles", label_te: "గీకుతారు", label_hi: "घसीट कर लिखता है", icon: "scribble", ageMonths: [12, 18] },
      { id: "fm_stacks", label: "Stacks 3+ blocks", label_te: "3+ బ్లాక్‌లు పేరుస్తారు", label_hi: "3+ ब्लॉक रखता है", icon: "stack", ageMonths: [15, 24] },
      { id: "fm_draws_line", label: "Draws a line", label_te: "గీత గీస్తారు", label_hi: "रेखा खींचता है", icon: "line", ageMonths: [20, 30] },
      { id: "fm_draws_circle", label: "Draws a circle", label_te: "వృత్తం గీస్తారు", label_hi: "गोला बनाता है", icon: "circle", ageMonths: [30, 42] },
    ],
  },
  {
    key: "language",
    label: "Language & Communication",
    label_te: "భాష & కమ్యూనికేషన్",
    label_hi: "भाषा और संवाद",
    color: "bg-purple-500",
    icon: <MessageCircle className="w-6 h-6" />,
    milestones: [
      { id: "lc_coos", label: "Coos and babbles", label_te: "గురుగురు శబ్దాలు", label_hi: "गुनगुनाता है", icon: "coo", ageMonths: [2, 5] },
      { id: "lc_responds_name", label: "Responds to name", label_te: "పేరుకు స్పందిస్తారు", label_hi: "नाम पर प्रतिक्रिया", icon: "name", ageMonths: [5, 9] },
      { id: "lc_first_words", label: "Says 1-2 words", label_te: "1-2 పదాలు చెప్తారు", label_hi: "1-2 शब्द बोलता है", icon: "word", ageMonths: [10, 15] },
      { id: "lc_10_words", label: "Uses 10+ words", label_te: "10+ పదాలు వాడతారు", label_hi: "10+ शब्द बोलता है", icon: "words", ageMonths: [15, 24] },
      { id: "lc_two_word", label: "Two-word phrases", label_te: "రెండు-పద వాక్యాలు", label_hi: "दो-शब्द वाक्य", icon: "phrase", ageMonths: [18, 30] },
      { id: "lc_sentences", label: "Simple sentences", label_te: "సరళ వాక్యాలు", label_hi: "सरल वाक्य", icon: "sentence", ageMonths: [24, 42] },
      { id: "lc_stories", label: "Tells simple stories", label_te: "సరళ కథలు చెప్తారు", label_hi: "सरल कहानी सुनाता है", icon: "story", ageMonths: [36, 60] },
    ],
  },
  {
    key: "cognitive",
    label: "Cognitive",
    label_te: "అభిజ్ఞా",
    label_hi: "संज्ञानात्मक",
    color: "bg-amber-500",
    icon: <Brain className="w-6 h-6" />,
    milestones: [
      { id: "cog_tracks", label: "Tracks objects with eyes", label_te: "కళ్ళతో వస్తువులను ట్రాక్ చేస్తారు", label_hi: "आँखों से वस्तु ट्रैक करता है", icon: "track", ageMonths: [1, 4] },
      { id: "cog_object_perm", label: "Looks for hidden object", label_te: "దాచిన వస్తువును వెతుకుతారు", label_hi: "छिपी वस्तु ढूंढता है", icon: "hide", ageMonths: [6, 10] },
      { id: "cog_cause_effect", label: "Understands cause-effect", label_te: "కారణ-ఫలితం అర్థం చేసుకుంటారు", label_hi: "कारण-प्रभाव समझता है", icon: "cause", ageMonths: [8, 14] },
      { id: "cog_sorts", label: "Sorts shapes/colors", label_te: "ఆకారాలు/రంగులు వేరు చేస్తారు", label_hi: "आकार/रंग छांटता है", icon: "sort", ageMonths: [18, 30] },
      { id: "cog_pretend", label: "Pretend play", label_te: "నటన ఆట", label_hi: "नकल का खेल", icon: "pretend", ageMonths: [18, 36] },
      { id: "cog_counts", label: "Counts to 5", label_te: "5 వరకు లెక్కిస్తారు", label_hi: "5 तक गिनता है", icon: "count", ageMonths: [30, 48] },
      { id: "cog_names_colors", label: "Names 3+ colors", label_te: "3+ రంగులు చెప్తారు", label_hi: "3+ रंग बताता है", icon: "color", ageMonths: [36, 54] },
    ],
  },
  {
    key: "social_emotional",
    label: "Social-Emotional",
    label_te: "సామాజిక-భావోద్వేగ",
    label_hi: "सामाजिक-भावनात्मक",
    color: "bg-rose-500",
    icon: <Heart className="w-6 h-6" />,
    milestones: [
      { id: "se_social_smile", label: "Social smile", label_te: "సామాజిక చిరునవ్వు", label_hi: "सामाजिक मुस्कान", icon: "smile", ageMonths: [1, 3] },
      { id: "se_stranger_anxiety", label: "Stranger anxiety", label_te: "అపరిచితుల భయం", label_hi: "अजनबी से डर", icon: "anxiety", ageMonths: [6, 12] },
      { id: "se_points", label: "Points to show interest", label_te: "ఆసక్తి చూపడానికి చూపుతారు", label_hi: "रुचि दिखाने के लिए इशारा", icon: "point", ageMonths: [9, 15] },
      { id: "se_parallel_play", label: "Plays alongside others", label_te: "ఇతరులతో ఆడతారు", label_hi: "दूसरों के साथ खेलता है", icon: "play", ageMonths: [18, 30] },
      { id: "se_takes_turns", label: "Takes turns", label_te: "వంతులు తీసుకుంటారు", label_hi: "बारी लेता है", icon: "turns", ageMonths: [24, 42] },
      { id: "se_empathy", label: "Shows empathy", label_te: "సానుభూతి చూపుతారు", label_hi: "सहानुभूति दिखाता है", icon: "empathy", ageMonths: [24, 48] },
      { id: "se_cooperative_play", label: "Cooperative play", label_te: "సహకార ఆట", label_hi: "सहयोगी खेल", icon: "coop", ageMonths: [36, 60] },
    ],
  },
];

// ─── Growth Measurement Fields ──────────────────────────────────────────────

interface GrowthData {
  weight_kg: string;
  height_cm: string;
  muac_cm: string;
  hemoglobin: string;
}

// ─── Assessment State ────────────────────────────────────────────────────────

interface AssessmentState {
  step: number; // 0=child select, 1-5=domains, 6=growth, 7=review
  childId: string;
  childAge: number;
  milestoneChecks: Record<string, boolean>;
  growthData: GrowthData;
  notes: string;
}

const TOTAL_STEPS = 8; // child select + 5 domains + growth + review

// ─── Component ──────────────────────────────────────────────────────────────

interface AssessmentCaptureFormProps {
  children: Array<{ child_id: string; age_months: number; mandal: string }>;
  lang?: "en" | "te" | "hi";
  onComplete?: () => void;
}

export default function AssessmentCaptureForm({
  children: childList,
  lang = "en",
  onComplete,
}: AssessmentCaptureFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<AssessmentState>({
    step: 0,
    childId: "",
    childAge: 0,
    milestoneChecks: {},
    growthData: { weight_kg: "", height_cm: "", muac_cm: "", hemoglobin: "" },
    notes: "",
  });

  const online = isOnline();
  const progress = ((state.step) / (TOTAL_STEPS - 1)) * 100;

  const getLabel = useCallback(
    (en: string, te: string, hi: string) => {
      if (lang === "te") return te;
      if (lang === "hi") return hi;
      return en;
    },
    [lang],
  );

  // Filter milestones relevant to child's age (show expected +/- 6 months)
  const getRelevantMilestones = (domain: DomainConfig) => {
    return domain.milestones.filter((m) => {
      const ageMin = Math.max(0, m.ageMonths[0] - 3);
      const ageMax = m.ageMonths[1] + 6;
      return state.childAge >= ageMin && state.childAge <= ageMax;
    });
  };

  const toggleMilestone = (milestoneId: string) => {
    setState((s) => ({
      ...s,
      milestoneChecks: {
        ...s.milestoneChecks,
        [milestoneId]: !s.milestoneChecks[milestoneId],
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const assessmentData: Record<string, unknown> = {
        child_id: state.childId,
        age_at_assessment: state.childAge,
        assessment_date: new Date().toISOString().split("T")[0],
        milestones: state.milestoneChecks,
        growth: state.growthData,
        notes: state.notes,
        // Compute per-domain delay counts
        gm_achieved: DOMAINS[0].milestones.filter((m) => state.milestoneChecks[m.id]).length,
        gm_total: getRelevantMilestones(DOMAINS[0]).length,
        fm_achieved: DOMAINS[1].milestones.filter((m) => state.milestoneChecks[m.id]).length,
        fm_total: getRelevantMilestones(DOMAINS[1]).length,
        lc_achieved: DOMAINS[2].milestones.filter((m) => state.milestoneChecks[m.id]).length,
        lc_total: getRelevantMilestones(DOMAINS[2]).length,
        cog_achieved: DOMAINS[3].milestones.filter((m) => state.milestoneChecks[m.id]).length,
        cog_total: getRelevantMilestones(DOMAINS[3]).length,
        se_achieved: DOMAINS[4].milestones.filter((m) => state.milestoneChecks[m.id]).length,
        se_total: getRelevantMilestones(DOMAINS[4]).length,
      };

      await dataService.createAssessment(state.childId, assessmentData);

      toast({
        title: getLabel("Assessment Saved", "అసెస్‌మెంట్ సేవ్ చేయబడింది", "मूल्यांकन सहेजा गया"),
        description: online
          ? getLabel("Synced to server", "సర్వర్‌కు సింక్ చేయబడింది", "सर्वर पर सिंक किया गया")
          : getLabel("Saved offline — will sync later", "ఆఫ్‌లైన్ సేవ్ — తర్వాత సింక్ అవుతుంది", "ऑफ़लाइन सहेजा — बाद में सिंक होगा"),
      });

      // Reset form
      setState({
        step: 0,
        childId: "",
        childAge: 0,
        milestoneChecks: {},
        growthData: { weight_kg: "", height_cm: "", muac_cm: "", hemoglobin: "" },
        notes: "",
      });

      onComplete?.();
    } catch {
      toast({
        title: getLabel("Save Failed", "సేవ్ విఫలమైంది", "सहेजना विफल"),
        description: getLabel("Please try again", "దయచేసి మళ్ళీ ప్రయత్నించండి", "कृपया पुनः प्रयास करें"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // ─── Step Renderers ──────────────────────────────────────────────────────

  const renderChildSelect = () => (
    <div className="space-y-3">
      <p className="text-base font-medium">
        {getLabel("Select Child", "పిల్లవాడిని ఎంచుకోండి", "बच्चा चुनें")}
      </p>
      <div className="grid gap-2 max-h-[400px] overflow-y-auto">
        {childList.map((child) => (
          <button
            key={child.child_id}
            onClick={() =>
              setState((s) => ({
                ...s,
                childId: child.child_id,
                childAge: child.age_months,
                step: 1,
              }))
            }
            className="flex items-center justify-between p-4 rounded-lg border-2 hover:border-primary hover:bg-primary/5 transition-all min-h-[56px] text-left"
          >
            <div className="flex items-center gap-3">
              <Baby className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{child.child_id}</p>
                <p className="text-xs text-muted-foreground">
                  {child.age_months} {getLabel("months", "నెలలు", "महीने")} · {child.mandal}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );

  const renderDomainStep = (domainIndex: number) => {
    const domain = DOMAINS[domainIndex];
    const relevant = getRelevantMilestones(domain);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${domain.color} text-white`}>
            {domain.icon}
          </div>
          <div>
            <p className="font-semibold text-base">
              {getLabel(domain.label, domain.label_te, domain.label_hi)}
            </p>
            <p className="text-xs text-muted-foreground">
              {getLabel(
                `Check each milestone the child has achieved`,
                `పిల్లవాడు సాధించిన ప్రతి మైలురాయిని తనిఖీ చేయండి`,
                `बच्चे द्वारा हासिल किया गया प्रत्येक मील का पत्थर चेक करें`,
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {relevant.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {getLabel(
                "No milestones expected for this age",
                "ఈ వయస్సుకు మైలురాళ్ళు లేవు",
                "इस उम्र के लिए कोई मील का पत्थर नहीं",
              )}
            </p>
          ) : (
            relevant.map((milestone) => {
              const checked = state.milestoneChecks[milestone.id] || false;
              const isDelayed = state.childAge > milestone.ageMonths[1] && !checked;

              return (
                <button
                  key={milestone.id}
                  onClick={() => toggleMilestone(milestone.id)}
                  className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-all min-h-[60px] text-left ${
                    checked
                      ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                      : isDelayed
                        ? "border-orange-300 bg-orange-50 dark:bg-orange-950/20"
                        : "border-border hover:border-primary/50"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      checked ? "bg-green-500 text-white" : "bg-muted"
                    }`}
                  >
                    {checked ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isDelayed ? (
                      <AlertTriangle className="w-5 h-5 text-orange-500" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {getLabel(milestone.label, milestone.label_te, milestone.label_hi)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getLabel("Expected", "ఆశించబడింది", "अपेक्षित")}: {milestone.ageMonths[0]}-{milestone.ageMonths[1]}{" "}
                      {getLabel("months", "నెలలు", "महीने")}
                    </p>
                  </div>
                  {isDelayed && (
                    <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
                      {getLabel("Delayed", "ఆలస్యం", "देरी")}
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderGrowthStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500 text-white">
          <Ruler className="w-6 h-6" />
        </div>
        <div>
          <p className="font-semibold text-base">
            {getLabel("Growth Measurements", "పెరుగుదల కొలతలు", "विकास माप")}
          </p>
          <p className="text-xs text-muted-foreground">
            {getLabel("Enter today's measurements", "నేటి కొలతలు నమోదు చేయండి", "आज के माप दर्ज करें")}
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {[
          { key: "weight_kg" as const, label: "Weight (kg)", label_te: "బరువు (కిలో)", label_hi: "वज़न (किलो)", icon: <Weight className="w-5 h-5" />, placeholder: "e.g. 8.5" },
          { key: "height_cm" as const, label: "Height (cm)", label_te: "ఎత్తు (సెం.మీ)", label_hi: "ऊँचाई (सेमी)", icon: <Ruler className="w-5 h-5" />, placeholder: "e.g. 72" },
          { key: "muac_cm" as const, label: "MUAC (cm)", label_te: "MUAC (సెం.మీ)", label_hi: "MUAC (सेमी)", icon: <Hand className="w-5 h-5" />, placeholder: "e.g. 13.5" },
          { key: "hemoglobin" as const, label: "Hemoglobin (g/dL)", label_te: "హీమోగ్లోబిన్ (గ్రా/డీఎల్)", label_hi: "हीमोग्लोबिन (ग्रा/डीएल)", icon: <Heart className="w-5 h-5" />, placeholder: "e.g. 11.2" },
        ].map((field) => (
          <div key={field.key} className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              {field.icon}
              {getLabel(field.label, field.label_te, field.label_hi)}
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder={field.placeholder}
              value={state.growthData[field.key]}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  growthData: { ...s.growthData, [field.key]: e.target.value },
                }))
              }
              className="w-full h-14 px-4 text-lg border-2 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
        ))}
      </div>

      <Separator />

      <div className="space-y-1">
        <label className="text-sm font-medium">
          {getLabel("Notes (optional)", "గమనికలు (ఐచ్ఛికం)", "नोट्स (वैकल्पिक)")}
        </label>
        <textarea
          value={state.notes}
          onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
          placeholder={getLabel("Any observations...", "ఏవైనా పరిశీలనలు...", "कोई भी अवलोकन...")}
          className="w-full h-24 px-4 py-3 text-sm border-2 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-none"
        />
      </div>
    </div>
  );

  const renderReview = () => {
    const totalChecked = Object.values(state.milestoneChecks).filter(Boolean).length;
    const totalRelevant = DOMAINS.reduce((sum, d) => sum + getRelevantMilestones(d).length, 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary text-white">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="font-semibold text-base">
              {getLabel("Review Assessment", "అసెస్‌మెంట్ సమీక్ష", "मूल्यांकन समीक्षा")}
            </p>
            <p className="text-xs text-muted-foreground">
              {getLabel("Check details before saving", "సేవ్ చేయడానికి ముందు వివరాలు తనిఖీ చేయండి", "सहेजने से पहले विवरण जांचें")}
            </p>
          </div>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{getLabel("Child ID", "పిల్లల ID", "बच्चे की ID")}</span>
            <span className="font-medium">{state.childId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{getLabel("Age", "వయస్సు", "उम्र")}</span>
            <span className="font-medium">{state.childAge} {getLabel("months", "నెలలు", "महीने")}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{getLabel("Milestones", "మైలురాళ్ళు", "मील का पत्थर")}</span>
            <span className="font-medium">{totalChecked} / {totalRelevant}</span>
          </div>
          <Separator />
          {DOMAINS.map((domain) => {
            const relevant = getRelevantMilestones(domain);
            const achieved = relevant.filter((m) => state.milestoneChecks[m.id]).length;
            const pct = relevant.length > 0 ? Math.round((achieved / relevant.length) * 100) : 100;

            return (
              <div key={domain.key} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${domain.color}`} />
                <span className="text-sm flex-1">{getLabel(domain.label, domain.label_te, domain.label_hi)}</span>
                <span className={`text-sm font-medium ${pct < 50 ? "text-red-500" : pct < 80 ? "text-amber-500" : "text-green-500"}`}>
                  {achieved}/{relevant.length} ({pct}%)
                </span>
              </div>
            );
          })}
          <Separator />
          {state.growthData.weight_kg && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{getLabel("Weight", "బరువు", "वज़न")}</span>
              <span className="font-medium">{state.growthData.weight_kg} kg</span>
            </div>
          )}
          {state.growthData.height_cm && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{getLabel("Height", "ఎత్తు", "ऊँचाई")}</span>
              <span className="font-medium">{state.growthData.height_cm} cm</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {online ? (
            <>
              <Wifi className="w-4 h-4 text-green-500" />
              {getLabel("Online — will sync immediately", "ఆన్‌లైన్ — వెంటనే సింక్ అవుతుంది", "ऑनलाइन — तुरंत सिंक होगा")}
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-amber-500" />
              {getLabel("Offline — will sync when connected", "ఆఫ్‌లైన్ — కనెక్ట్ అయినప్పుడు సింక్ అవుతుంది", "ऑफ़लाइन — कनेक्ट होने पर सिंक होगा")}
            </>
          )}
        </div>
      </div>
    );
  };

  // ─── Main Render ──────────────────────────────────────────────────────────

  return (
    <Card className="w-full max-w-lg mx-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" />
            {getLabel("New Assessment", "కొత్త అసెస్‌మెంట్", "नया मूल्यांकन")}
          </CardTitle>
          {state.step > 0 && (
            <Badge variant="outline" className="text-xs">
              {state.step}/{TOTAL_STEPS - 1}
            </Badge>
          )}
        </div>
        {state.step > 0 && <Progress value={progress} className="h-2 mt-2" />}
      </CardHeader>

      <CardContent className="space-y-4">
        {state.step === 0 && renderChildSelect()}
        {state.step >= 1 && state.step <= 5 && renderDomainStep(state.step - 1)}
        {state.step === 6 && renderGrowthStep()}
        {state.step === 7 && renderReview()}

        {state.step > 0 && (
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 h-12"
              onClick={() => setState((s) => ({ ...s, step: s.step - 1 }))}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              {getLabel("Back", "వెనక్కి", "वापस")}
            </Button>

            {state.step < TOTAL_STEPS - 1 ? (
              <Button
                className="flex-1 h-12"
                onClick={() => setState((s) => ({ ...s, step: s.step + 1 }))}
              >
                {getLabel("Next", "తదుపరి", "अगला")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                className="flex-1 h-12"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="w-4 h-4 mr-1" />
                {saving
                  ? getLabel("Saving...", "సేవ్ అవుతోంది...", "सहेज रहा है...")
                  : getLabel("Save Assessment", "అసెస్‌మెంట్ సేవ్ చేయండి", "मूल्यांकन सहेजें")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
