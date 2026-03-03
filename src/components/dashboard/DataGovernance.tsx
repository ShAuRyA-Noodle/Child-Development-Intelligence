import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";

const items = [
  "DPDP Act 2023 Compliant",
  "Consent-Based Data Capture",
  "Role-Based Access Control",
  "Explainable AI Layer",
  "API Integrated with ICDS",
];

export default function DataGovernance() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.0, duration: 0.5 }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Data Governance & Compliance
      </h2>
      <div className="bg-card rounded-lg border border-border p-5 card-hover">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {items.map((item, i) => (
            <motion.div
              key={item}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.1 + i * 0.08, duration: 0.3 }}
              className="flex items-center gap-2 p-3 rounded-md bg-secondary/50"
            >
              <ShieldCheck className="w-4 h-4 text-risk-low shrink-0" />
              <span className="text-xs font-medium text-foreground">{item}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
