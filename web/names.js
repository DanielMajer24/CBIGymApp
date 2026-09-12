function clean(value) {
  return String(value || "").trim();
}

export function athleteFirstName(athlete) {
  const firstName = clean(athlete?.first_name);
  if (firstName) return firstName;
  return clean(athlete?.name).split(/\s+/)[0] || "Athlete";
}

export function athleteFullName(athlete) {
  const firstName = clean(athlete?.first_name);
  const lastName = clean(athlete?.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return fullName || clean(athlete?.name) || "Athlete";
}

export function athletePickerLabel(athlete, teamAthletes) {
  const firstName = athleteFirstName(athlete);
  const matchingFirstNames = teamAthletes.filter((candidate) =>
    athleteFirstName(candidate).toLocaleLowerCase() === firstName.toLocaleLowerCase()
  );
  if (matchingFirstNames.length < 2) return firstName;

  const lastInitial = clean(athlete?.last_name).slice(0, 1).toLocaleUpperCase();
  return lastInitial ? firstName + " " + lastInitial + "." : firstName;
}
