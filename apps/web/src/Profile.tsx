import { useEffect, useState } from "react";
import { fetchMyProfile, type PlayerProfile } from "./api";
import { TOWER_NAME } from "./arcadeRules";
import { dayHash, formatDay } from "./History";
import { CompareTiles, RoundsCompare } from "./ProfileCharts";
import { ProfileHero, TowerCard } from "./ProfileStats";
import { puzzleNumber } from "./share";

/** The player's own profile. Private: only ever shows the logged-in account. */
export const PROFILE_HASH = "#profile";

export function Profile({ loggedIn, onLogIn }: { loggedIn: boolean; onLogIn: () => void }) {
  const [profile, setProfile] = useState<PlayerProfile>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loggedIn) return;
    let current = true;
    fetchMyProfile().then(
      (result) => current && setProfile(result),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [loggedIn]);

  return (
    <section className="history profile" aria-labelledby="profile-title">
      <p className="history-nav">
        <a href="#">← Back to today's round</a>
      </p>
      {!loggedIn ? (
        <>
          <h2 id="profile-title" className="history-title">
            Your profile
          </h2>
          <p className="history-note">
            Your stats, how you compare with everyone, and your first-solve badges live here.{" "}
            <button type="button" className="link" onClick={onLogIn}>
              Log in
            </button>{" "}
            to see them.
          </p>
        </>
      ) : failed ? (
        <p className="status">Couldn't load your profile.</p>
      ) : !profile ? (
        <p className="status">Loading…</p>
      ) : (
        <ProfileView profile={profile} />
      )}
    </section>
  );
}

function ProfileView({ profile }: { profile: PlayerProfile }) {
  const since = new Date(profile.memberSince).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <div className="history-head">
        <h2 id="profile-title" className="history-title">
          {profile.username}
        </h2>
        <p className="history-summary">Playing since {since}</p>
      </div>
      <p className="history-note">Only you can see this page.</p>

      <ProfileHero profile={profile} />

      <h3 className="profile-section-title">How you compare</h3>
      <CompareTiles profile={profile} />

      <h3 className="profile-section-title">Round by round</h3>
      <RoundsCompare profile={profile} maxGuesses={profile.solvedIn.length} />

      <div className="profile-section-head">
        <h3 className="profile-section-title">First solves</h3>
        <p className="history-summary">{profile.firstSolves.length}</p>
      </div>
      {profile.firstSolves.length === 0 ? (
        <p className="history-note">Be the first logged-in player to solve a day's round and its badge goes here, for good.</p>
      ) : (
        <ul className="badges">
          {profile.firstSolves.map(({ date, answer }) => (
            <li key={date}>
              <a className="badge" href={dayHash(date)} title={`${answer.name} (${answer.franchise})`}>
                {answer.portraitUrl ? (
                  <img className="badge-portrait" src={answer.portraitUrl} alt="" width={72} height={96} loading="lazy" />
                ) : (
                  <span className="badge-portrait badge-portrait--empty" aria-hidden="true">
                    🥇
                  </span>
                )}
                <span className="badge-medal" aria-hidden="true">
                  🥇
                </span>
                <span className="badge-round">Round {puzzleNumber(date)}</span>
                <span className="badge-date">{formatDay(date, "short")}</span>
                <span className="visually-hidden">: first to solve {answer.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <h3 className="profile-section-title">{TOWER_NAME}</h3>
      <TowerCard tower={profile.tower} />
    </>
  );
}
