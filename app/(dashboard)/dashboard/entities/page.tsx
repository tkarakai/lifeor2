"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, User, Building, Home, Car, Landmark } from "lucide-react";

const entityKinds = [
  { value: "Person", label: "Person", icon: User },
  { value: "LLC", label: "LLC", icon: Building },
  { value: "House", label: "House", icon: Home },
  { value: "Car", label: "Car", icon: Car },
  { value: "Bank", label: "Bank", icon: Landmark },
];

export default function EntitiesPage() {
  const entities = useQuery(api.entities.list) || [];
  const createEntity = useMutation(api.entities.create);
  const deleteEntity = useMutation(api.entities.remove);

  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState("Person");
  const [displayName, setDisplayName] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createEntity({ kind, display_name: displayName });
    setDisplayName("");
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this entity?")) {
      await deleteEntity({ id: id as any });
    }
  };

  const getIcon = (kind: string) => {
    const entityKind = entityKinds.find((k) => k.value === kind);
    return entityKind?.icon || User;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Entities</h1>
          <p className="text-muted-foreground">
            Manage people, organizations, and things
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Entity
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Entity</CardTitle>
            <CardDescription>Add a person, organization, or thing</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Kind</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  {entityKinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Display Name</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter name"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit">Create</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {entities.map((entity) => {
          const Icon = getIcon(entity.kind);
          return (
            <Card key={entity._id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">{entity.display_name}</CardTitle>
                  </div>
                </div>
                <CardDescription>{entity.kind}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(entity._id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {entities.length === 0 && !showForm && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <User className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No entities yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first entity to get started
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Entity
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
