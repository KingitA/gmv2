import { Badge } from "@/components/ui/badge"
import { Banknote, CreditCard, FileCheck, Smartphone } from "lucide-react"

export function PaymentMethodBadge({ method }: { method: string }) {
    const getIcon = () => {
        switch (method) {
            case "EFECTIVO":
                return <Banknote className="h-3 w-3" />
            case "TRANSFERENCIA":
            case "DEPOSITO":
                return <FileCheck className="h-3 w-3" />
            case "MERCADOPAGO":
                return <Smartphone className="h-3 w-3" />
            case "CHEQUE_TERCERO":
            case "CHEQUE_PROPIO":
                return <CreditCard className="h-3 w-3" />
            default:
                return null
        }
    }

    return (
        <Badge variant="outline" className="gap-1">
            {getIcon()}
            <span className="capitalize">{method.replace(/_/g, " ").toLowerCase()}</span>
        </Badge>
    )
}
