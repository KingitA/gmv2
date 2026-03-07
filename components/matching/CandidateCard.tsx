import { MatchCandidate } from "@/lib/matching/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface CandidateCardProps {
    candidate: MatchCandidate;
    onApprove: (id: string, method: string, score: number) => void;
    isBest?: boolean;
}

export function CandidateCard({ candidate, onApprove, isBest }: CandidateCardProps) {
    const scorePercent = Math.round(candidate.score * 100);

    // Color coding
    const scoreColor = scorePercent > 90 ? "text-green-600" : scorePercent > 75 ? "text-yellow-600" : "text-red-500";
    const borderColor = isBest ? "border-blue-300 bg-blue-50/50" : "border-slate-200";

    return (
        <div className={cn("border rounded-lg p-3 space-y-2 text-sm", borderColor)}>
            <div className="flex justify-between items-start">
                <div>
                    <div className="font-semibold">{candidate.sku_name}</div>
                    <div className="text-xs text-muted-foreground">SKU: {candidate.sku_code}</div>
                </div>
                <div className={cn("font-bold text-lg", scoreColor)}>
                    {scorePercent}%
                </div>
            </div>

            <div className="space-y-1">
                {candidate.signals.map((sig, idx) => (
                    <div key={idx} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] h-5 px-1">
                            {sig.type}
                        </Badge>
                        <span>{sig.description}</span>
                    </div>
                ))}
            </div>

            <Button
                size="sm"
                variant={isBest ? "default" : "outline"}
                className="w-full text-xs h-7 mt-2"
                onClick={() => onApprove(candidate.sku_id, candidate.method, candidate.score)}
            >
                <Check className="w-3 h-3 mr-1" />
                Vincular
            </Button>
        </div>
    );
}
