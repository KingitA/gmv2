import { Badge } from "@/components/ui/badge"

export function MoneyColorBadge({ color }: { color: "BLANCO" | "NEGRO" }) {
    return (
        <Badge
            variant={color === "BLANCO" ? "default" : "secondary"}
            className={color === "BLANCO" ? "bg-blue-100 text-blue-800" : "bg-gray-800 text-white"}
        >
            {color}
        </Badge>
    )
}
