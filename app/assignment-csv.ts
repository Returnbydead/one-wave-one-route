type LockedCsvAssignment = {
  source: "auto" | "manual";
  picker: { staffId: string };
  orders: Array<{ soNumber: string; route: string }>;
};

function extractWmsSoId(soNumber: string) {
  return soNumber.replace(/\D/g, "").slice(-7).padStart(7, "0");
}

export function buildLockedCsv(
  assignments: LockedCsvAssignment[],
  route?: string,
) {
  const rows = ["error_message;so_id;staff_id"];

  assignments
    .filter((assignment) => assignment.source === "manual")
    .forEach((assignment) => {
      assignment.orders
        .filter((order) => !route || order.route === route)
        .forEach((order) => {
          rows.push(
            `;${extractWmsSoId(order.soNumber)};${assignment.picker.staffId}`,
          );
        });
    });

  return "\ufeff" + rows.join("\n");
}
