import { Card, CardContent } from "@/components/ui/card";
import PlatformChannelForm from "@/components/PlatformChannelForm";

export default function Home() {
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
