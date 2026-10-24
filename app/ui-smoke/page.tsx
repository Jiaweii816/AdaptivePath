import { ChevronDown, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function UiSmokePage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto grid w-full max-w-5xl gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              PatternCoach AI
            </p>
            <h1 className="mt-1 text-3xl font-semibold leading-tight text-foreground">
              UI Smoke
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">
              <Play className="h-4 w-4" aria-hidden="true" />
              Review My Code
            </Button>
            <Button size="sm" variant="outline">
              Secondary
            </Button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Shared Controls</CardTitle>
              <CardDescription>
                Button, input, menu, select, dialog, and tabs in one route.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="problem-search"
                >
                  Problem
                </label>
                <Input
                  defaultValue="Search Insert Position"
                  id="problem-search"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Select defaultValue="python">
                  <SelectTrigger aria-label="Language">
                    <SelectValue placeholder="Language" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="python">Python</SelectItem>
                    <SelectItem value="cpp">C++</SelectItem>
                  </SelectContent>
                </Select>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      Iris904
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Local MVP</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>Profile</DropdownMenuItem>
                    <DropdownMenuItem>Problem History</DropdownMenuItem>
                    <DropdownMenuItem>Chat History</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
            <CardFooter>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="secondary">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Open Dialog
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Component Check</DialogTitle>
                    <DialogDescription>
                      This dialog uses the same primitives the app shell will
                      reuse later.
                    </DialogDescription>
                  </DialogHeader>
                  <Button>Done</Button>
                </DialogContent>
              </Dialog>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Panel States</CardTitle>
              <CardDescription>
                Compact surfaces for repeated workbench interactions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="run">
                <TabsList>
                  <TabsTrigger value="run">Run</TabsTrigger>
                  <TabsTrigger value="coach">Coach</TabsTrigger>
                  <TabsTrigger value="memory">Memory</TabsTrigger>
                </TabsList>
                <TabsContent value="run">
                  <p className="font-medium text-foreground">
                    passed_visible_tests
                  </p>
                  <p className="text-muted-foreground">3/3 visible tests</p>
                </TabsContent>
                <TabsContent value="coach">
                  Focus on the first failed case before offering an optimized
                  path.
                </TabsContent>
                <TabsContent value="memory">
                  L1 append, L2 deterministic upsert, L3 background synthesis.
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
