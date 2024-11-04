import { Card, CardContent } from "@/components/ui/card";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();

  // Default home view remains unchanged
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-6xl font-bold text-center mb-8">ContentFind</h1>
      <Card className="max-w-xl w-full">
        <CardContent className="p-6">
          <PlatformChannelForm />
        </CardContent>
      </Card>
    </div>
  );
}
