import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Flag,
  Heart,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import AppSelect from "@/components/app-select";
import type { StudentGradeLevel } from "@/lib/studentsApi";
import {
  addPostCommentApi,
  createCommunityPostApi,
  deleteCommunityPostApi,
  fetchCommunityPosts,
  fetchMyCommunityProfile,
  fetchPostComments,
  reportCommunityPostApi,
  StudentsExtendedApiError,
  toggleFollowStudentApi,
  toggleLikePostApi,
  updateMyCommunityProfileApi,
  type CommunityCommentItem,
  type CommunityPostItem,
  type CommunityPostType,
  type CommunityReportReason,
  type StudentPublicProfile,
} from "@/lib/studentsExtendedApi";
import "./students-exams.css";

const COMMUNITY_SUBJECTS = [
  "Biology",
  "Physics",
  "Chemistry",
  "Mathematics",
  "History",
  "Geography",
  "Computer Science",
  "Literature & Languages",
  "General",
];

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "مجتمع الطلاب الآمن",
      privacyBadge:
        "حماية الخصوصية مفعّلة: لا تُعرض إيميلات أو بيانات الطلاب الخاصة، ويُمنع نشر أرقام الهواتف.",
      editProfile: "تعديل ملفي",
      saveProfile: "حفظ الملف",
      cancel: "إلغاء",
      nameLbl: "الاسم المعروض للطلاب",
      bioLbl: "نبذة دراسية قصيرة",
      gradeLbl: "المستوى الدراسي",
      followers: "متابِعون",
      following: "أُتابع",
      posts: "منشورات",
      newPostBtn: "مشاركة منشور تعليمي",
      postTypeLbl: "نوع المشاركة",
      postTypes: {
        summary: "ملخص درس",
        question: "سؤال طلابي",
        exam_share: "مشاركة امتحان",
        resource_share: "مصدر تعليمي",
      } as Record<CommunityPostType, string>,
      grades: {
        elementary: "ابتدائي",
        middle: "إعدادي",
        high_school: "ثانوي",
        university: "جامعي",
      } as Record<StudentGradeLevel, string>,
      subjectLbl: "المادة",
      allLabel: "الكل",
      onlyFollowing: "من أتابعهم فقط",
      searchPh: "ابحث في المنشورات والأسئلة والملخصات...",
      titlePh: "عنوان واضح ومختصر...",
      bodyPh: "اكتب الملخص أو السؤال أو أسئلة الامتحان (بدون بريد إلكتروني أو هاتف)...",
      urlPh: "رابط مصدر تعليمي موثّق https:// (اختياري)",
      tagsPh: "وسوم مفصولة بفاصلة (مثلاً: أحياء، مراجعة)",
      publishBtn: "نشر في المجتمع",
      publishing: "جارٍ النشر...",
      follow: "متابعة",
      followed: "متابَع",
      comments: "تعليقات",
      commentPh: "أضف تعليقاً أو إجابة مفيدة...",
      report: "إبلاغ",
      reportTitle: "الإبلاغ عن محتوى مخالف (إشراف المجتمع)",
      reportReasons: {
        spam: "محتوى مزعج / سبام",
        harassment: "إساءة أو تنمّر",
        misinformation: "معلومة علمية مضلّلة",
        inappropriate: "محتوى غير لائق",
        privacy: "يكشف بيانات شخصية",
      } as Record<CommunityReportReason, string>,
      sendReport: "إرسال البلاغ",
      reportedOk: "تم استلام البلاغ بنجاح للمراجعة الإشرافية.",
      emptyFeed: "لا توجد مشاركات مطابقة للبحث بعد. كن أول من يشارك ملخصاً أو سؤالاً!",
      openLink: "فتح المصدر",
    };
  }
  return {
    title: "Moderated Student Community",
    privacyBadge:
      "Privacy Protected: private emails & account data are never exposed, and posting personal contact info is blocked.",
    editProfile: "Edit Profile",
    saveProfile: "Save Profile",
    cancel: "Cancel",
    nameLbl: "Public Display Name",
    bioLbl: "Short Study Bio",
    gradeLbl: "Grade Level",
    followers: "Followers",
    following: "Following",
    posts: "Posts",
    newPostBtn: "Share Study Post",
    postTypeLbl: "Post Type",
    postTypes: {
      summary: "Lesson Summary",
      question: "Study Question",
      exam_share: "Exam Share",
      resource_share: "Educational Resource",
    } as Record<CommunityPostType, string>,
    grades: {
      elementary: "Elementary",
      middle: "Middle School",
      high_school: "High School",
      university: "University",
    } as Record<StudentGradeLevel, string>,
    subjectLbl: "Subject",
    allLabel: "All",
    onlyFollowing: "Following Only",
    searchPh: "Search summaries, questions, exams, or resources...",
    titlePh: "Clear post title...",
    bodyPh: "Share your summary, question, or exam notes (no emails or phone numbers)...",
    urlPh: "Optional verified https:// educational resource link",
    tagsPh: "Optional comma-separated tags (e.g. biology, revision)",
    publishBtn: "Publish Post",
    publishing: "Publishing...",
    follow: "Follow",
    followed: "Following",
    comments: "Comments",
    commentPh: "Add a helpful comment or answer...",
    report: "Report",
    reportTitle: "Report Post for Moderation",
    reportReasons: {
      spam: "Spam / Advertising",
      harassment: "Harassment / Abuse",
      misinformation: "Academic Misinformation",
      inappropriate: "Inappropriate Content",
      privacy: "Exposes Private Information",
    } as Record<CommunityReportReason, string>,
    sendReport: "Submit Report",
    reportedOk: "Report submitted for moderation.",
    emptyFeed: "No matching posts yet. Be the first to share a summary, exam, or question!",
    openLink: "Open Resource",
  };
}

type StudentsCommunityPanelProps = {
  locale: string;
  defaultSubject: string;
  defaultGradeLevel: StudentGradeLevel;
  getIdToken?: () => Promise<string>;
};

export default function StudentsCommunityPanel({
  locale,
  defaultSubject,
  defaultGradeLevel,
  getIdToken,
}: StudentsCommunityPanelProps) {
  const isRtl = locale.startsWith("ar");
  const ui = getCopy(locale);

  const [profile, setProfile] = useState<StudentPublicProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profName, setProfName] = useState("");
  const [profBio, setProfBio] = useState("");
  const [profGrade, setProfGrade] = useState<StudentGradeLevel>(defaultGradeLevel);

  const [posts, setPosts] = useState<CommunityPostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSubject, setFilterSubject] = useState("all");
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [onlyFollowing, setOnlyFollowing] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  const [composerOpen, setComposerOpen] = useState(false);
  const [postType, setPostType] = useState<CommunityPostType>("summary");
  const [postSubject, setPostSubject] = useState(
    COMMUNITY_SUBJECTS.includes(defaultSubject) ? defaultSubject : "General",
  );
  const [postGrade, setPostGrade] = useState<StudentGradeLevel>(defaultGradeLevel);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [postTags, setPostTags] = useState("");
  const [publishing, setPublishing] = useState(false);

  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<
    Record<string, CommunityCommentItem[]>
  >({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  const [reportingPostId, setReportingPostId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<CommunityReportReason>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadFeed = useCallback(async () => {
    if (!getIdToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const tok = await getIdToken();
      const [prof, list] = await Promise.all([
        fetchMyCommunityProfile(tok),
        fetchCommunityPosts(tok, {
          subject: filterSubject,
          gradeLevel: filterGrade,
          postType: filterType,
          q: searchQ,
          following: onlyFollowing,
        }),
      ]);
      setProfile(prof);
      setProfName(prof.displayName);
      setProfBio(prof.bio);
      setProfGrade(prof.gradeLevel);
      setPosts(list);
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError
          ? err.message
          : "Could not load Student Community.",
      );
    } finally {
      setLoading(false);
    }
  }, [getIdToken, filterSubject, filterGrade, filterType, searchQ, onlyFollowing]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const handleSaveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!getIdToken) return;
    setError("");
    try {
      const tok = await getIdToken();
      const updated = await updateMyCommunityProfileApi(tok, {
        displayName: profName,
        bio: profBio,
        gradeLevel: profGrade,
      });
      setProfile(updated);
      setEditingProfile(false);
      setNotice(locale.startsWith("ar") ? "تم تحديث ملفك الشخصي." : "Profile updated.");
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError
          ? err.message
          : "Could not save profile.",
      );
    }
  };

  const handlePublishPost = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!getIdToken || publishing) return;
    setPublishing(true);
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      const created = await createCommunityPostApi(tok, {
        postType,
        subject: postSubject,
        gradeLevel: postGrade,
        title: postTitle,
        content: postBody,
        resourceUrl: postUrl.trim() || undefined,
        tags: postTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setPosts((prev) => [created, ...prev]);
      setPostTitle("");
      setPostBody("");
      setPostUrl("");
      setPostTags("");
      setComposerOpen(false);
      setProfile((p) => (p ? { ...p, postsCount: p.postsCount + 1 } : p));
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError ? err.message : "Could not publish post.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleToggleLike = async (postId: string) => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      const res = await toggleLikePostApi(tok, postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, likedByMe: res.liked, likesCount: res.likesCount }
            : p,
        ),
      );
    } catch {
      // ignore
    }
  };

  const handleToggleFollow = async (handleId: string) => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      const res = await toggleFollowStudentApi(tok, handleId);
      setPosts((prev) =>
        prev.map((p) =>
          p.authorHandleId === handleId
            ? { ...p, authorFollowedByMe: res.following }
            : p,
        ),
      );
      setProfile((p) =>
        p
          ? {
              ...p,
              followingCount: Math.max(
                0,
                p.followingCount + (res.following ? 1 : -1),
              ),
            }
          : p,
      );
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError ? err.message : "Follow failed.",
      );
    }
  };

  const handleToggleComments = async (postId: string) => {
    if (openCommentsId === postId) {
      setOpenCommentsId(null);
      return;
    }
    setOpenCommentsId(postId);
    setCommentDraft("");
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      const list = await fetchPostComments(tok, postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: list }));
    } catch {
      // ignore
    }
  };

  const handleAddComment = async (postId: string) => {
    if (!getIdToken || !commentDraft.trim() || commentBusy) return;
    setCommentBusy(true);
    setError("");
    try {
      const tok = await getIdToken();
      const created = await addPostCommentApi(tok, postId, commentDraft);
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: [...(prev[postId] ?? []), created],
      }));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p,
        ),
      );
      setCommentDraft("");
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError ? err.message : "Could not comment.",
      );
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      await deleteCommunityPostApi(tok, postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch {
      setError("Could not delete post.");
    }
  };

  const handleSubmitReport = async (postId: string) => {
    if (!getIdToken) return;
    setError("");
    try {
      const tok = await getIdToken();
      const res = await reportCommunityPostApi(
        tok,
        postId,
        reportReason,
        reportDetails,
      );
      setReportingPostId(null);
      setReportDetails("");
      setNotice(ui.reportedOk);
      if (res.autoHidden) {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      }
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError ? err.message : "Report failed.",
      );
    }
  };

  return (
    <div className="st-panel" data-testid="students-community-panel">
      <div className="st-head-row">
        <div className="st-row">
          <Users size={18} />
          <strong style={{ fontSize: 15 }}>{ui.title}</strong>
        </div>
        <button
          type="button"
          className="st-btn is-primary"
          onClick={() => setComposerOpen((v) => !v)}
          data-testid="button-community-new-post"
        >
          <Plus size={14} />
          <span>{ui.newPostBtn}</span>
        </button>
      </div>

      <div className="st-banner-ok">
        <ShieldCheck size={15} />
        <span>{ui.privacyBadge}</span>
      </div>

      {notice && (
        <div className="st-banner-ok" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="st-banner-err" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Student Public Profile Card */}
      {profile && (
        <div className="sc-profile-card">
          <div className="st-head-row">
            <div className="st-row">
              <span className="sc-avatar" aria-hidden="true">
                {profile.displayName.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong dir="auto">{profile.displayName}</strong>
                <div className="st-row" style={{ marginTop: 3 }}>
                  <span className="st-pill is-gold">{ui.grades[profile.gradeLevel]}</span>
                  <span className="st-pill">
                    {profile.followersCount} {ui.followers}
                  </span>
                  <span className="st-pill">
                    {profile.followingCount} {ui.following}
                  </span>
                  <span className="st-pill">
                    {profile.postsCount} {ui.posts}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="st-btn"
              onClick={() => setEditingProfile((v) => !v)}
            >
              <Pencil size={13} />
              <span>{ui.editProfile}</span>
            </button>
          </div>
          {profile.bio && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--app-secondary)" }} dir="auto">
              {profile.bio}
            </p>
          )}

          {editingProfile && (
            <form className="se-stack" onSubmit={(e) => void handleSaveProfile(e)}>
              <div className="st-config-grid">
                <div className="st-field">
                  <label>{ui.nameLbl}</label>
                  <input
                    className="st-input"
                    maxLength={48}
                    value={profName}
                    onChange={(e) => setProfName(e.currentTarget.value)}
                  />
                </div>
                <div className="st-field">
                  <label>{ui.gradeLbl}</label>
                  <AppSelect
                    title={ui.gradeLbl}
                    value={profGrade}
                    dir={isRtl ? "rtl" : "ltr"}
                    options={(Object.keys(ui.grades) as StudentGradeLevel[]).map((g) => ({
                      value: g,
                      label: ui.grades[g],
                    }))}
                    onChange={(v) => setProfGrade(v as StudentGradeLevel)}
                  />
                </div>
              </div>
              <div className="st-field">
                <label>{ui.bioLbl}</label>
                <input
                  className="st-input"
                  maxLength={260}
                  value={profBio}
                  onChange={(e) => setProfBio(e.currentTarget.value)}
                />
              </div>
              <div className="st-row">
                <button type="submit" className="st-btn is-primary">
                  {ui.saveProfile}
                </button>
                <button
                  type="button"
                  className="st-btn"
                  onClick={() => setEditingProfile(false)}
                >
                  {ui.cancel}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* New Post Composer */}
      {composerOpen && (
        <form className="se-card is-highlight" onSubmit={(e) => void handlePublishPost(e)}>
          <div className="st-config-grid">
            <div className="st-field">
              <label>{ui.postTypeLbl}</label>
              <AppSelect
                title={ui.postTypeLbl}
                value={postType}
                dir={isRtl ? "rtl" : "ltr"}
                options={(Object.keys(ui.postTypes) as CommunityPostType[]).map((pt) => ({
                  value: pt,
                  label: ui.postTypes[pt],
                }))}
                onChange={(v) => setPostType(v as CommunityPostType)}
              />
            </div>
            <div className="st-field">
              <label>{ui.subjectLbl}</label>
              <AppSelect
                title={ui.subjectLbl}
                value={postSubject}
                dir={isRtl ? "rtl" : "ltr"}
                options={COMMUNITY_SUBJECTS.map((s) => ({ value: s, label: s }))}
                onChange={setPostSubject}
              />
            </div>
            <div className="st-field">
              <label>{ui.gradeLbl}</label>
              <AppSelect
                title={ui.gradeLbl}
                value={postGrade}
                dir={isRtl ? "rtl" : "ltr"}
                options={(Object.keys(ui.grades) as StudentGradeLevel[]).map((g) => ({
                  value: g,
                  label: ui.grades[g],
                }))}
                onChange={(v) => setPostGrade(v as StudentGradeLevel)}
              />
            </div>
          </div>

          <input
            className="st-input"
            dir="auto"
            maxLength={140}
            required
            placeholder={ui.titlePh}
            value={postTitle}
            onChange={(e) => setPostTitle(e.currentTarget.value)}
          />
          <textarea
            className="st-textarea"
            dir="auto"
            maxLength={4000}
            required
            placeholder={ui.bodyPh}
            value={postBody}
            onChange={(e) => setPostBody(e.currentTarget.value)}
          />
          <input
            className="st-input"
            type="url"
            dir="ltr"
            placeholder={ui.urlPh}
            value={postUrl}
            onChange={(e) => setPostUrl(e.currentTarget.value)}
          />
          <input
            className="st-input"
            dir="auto"
            placeholder={ui.tagsPh}
            value={postTags}
            onChange={(e) => setPostTags(e.currentTarget.value)}
          />
          <div className="st-row">
            <button
              type="submit"
              className="st-btn is-primary"
              disabled={publishing || !postTitle.trim() || !postBody.trim()}
            >
              {publishing ? (
                <LoaderCircle className="loading-spinner" size={14} />
              ) : (
                <Send size={14} />
              )}
              <span>{publishing ? ui.publishing : ui.publishBtn}</span>
            </button>
            <button
              type="button"
              className="st-btn"
              onClick={() => setComposerOpen(false)}
            >
              {ui.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Search & Filters (Subject + Level + Type + Following) */}
      <div className="st-config-grid">
        <div className="st-field">
          <label>{ui.subjectLbl}</label>
          <AppSelect
            title={ui.subjectLbl}
            value={filterSubject}
            dir={isRtl ? "rtl" : "ltr"}
            options={[
              { value: "all", label: ui.allLabel },
              ...COMMUNITY_SUBJECTS.map((s) => ({ value: s, label: s })),
            ]}
            onChange={setFilterSubject}
          />
        </div>
        <div className="st-field">
          <label>{ui.gradeLbl}</label>
          <AppSelect
            title={ui.gradeLbl}
            value={filterGrade}
            dir={isRtl ? "rtl" : "ltr"}
            options={[
              { value: "all", label: ui.allLabel },
              ...(Object.keys(ui.grades) as StudentGradeLevel[]).map((g) => ({
                value: g,
                label: ui.grades[g],
              })),
            ]}
            onChange={setFilterGrade}
          />
        </div>
        <div className="st-field">
          <label>{ui.postTypeLbl}</label>
          <AppSelect
            title={ui.postTypeLbl}
            value={filterType}
            dir={isRtl ? "rtl" : "ltr"}
            options={[
              { value: "all", label: ui.allLabel },
              ...(Object.keys(ui.postTypes) as CommunityPostType[]).map((pt) => ({
                value: pt,
                label: ui.postTypes[pt],
              })),
            ]}
            onChange={setFilterType}
          />
        </div>
      </div>

      <div className="st-row">
        <input
          className="st-input"
          style={{ flex: 1 }}
          type="search"
          dir="auto"
          placeholder={ui.searchPh}
          value={searchQ}
          onChange={(e) => setSearchQ(e.currentTarget.value)}
        />
        <button
          type="button"
          className={`se-type-toggle${onlyFollowing ? " is-on" : ""}`}
          onClick={() => setOnlyFollowing((v) => !v)}
        >
          <Search size={12} />
          <span>{ui.onlyFollowing}</span>
        </button>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="st-empty">
          <LoaderCircle className="loading-spinner" size={20} />
        </div>
      ) : posts.length === 0 ? (
        <div className="st-empty">{ui.emptyFeed}</div>
      ) : (
        <div className="se-stack">
          {posts.map((post) => {
            const commentsOpen = openCommentsId === post.id;
            const comments = commentsByPost[post.id] ?? [];
            return (
              <article key={post.id} className="sc-post-card">
                <div className="st-head-row">
                  <div className="st-row">
                    <strong dir="auto" style={{ fontSize: 13.5 }}>
                      {post.authorName}
                    </strong>
                    <span className="st-pill is-gold">
                      {ui.postTypes[post.postType]}
                    </span>
                    <span className="st-pill">{post.subject}</span>
                    <span className="st-pill">{ui.grades[post.gradeLevel]}</span>
                  </div>
                  <div className="st-row">
                    {!post.isMine && (
                      <button
                        type="button"
                        className={`st-btn${post.authorFollowedByMe ? " is-primary" : ""}`}
                        onClick={() => void handleToggleFollow(post.authorHandleId)}
                      >
                        {post.authorFollowedByMe ? (
                          <UserCheck size={13} />
                        ) : (
                          <UserPlus size={13} />
                        )}
                        <span>
                          {post.authorFollowedByMe ? ui.followed : ui.follow}
                        </span>
                      </button>
                    )}
                    {post.isMine && (
                      <button
                        type="button"
                        className="st-btn is-danger"
                        onClick={() => void handleDeletePost(post.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <strong dir="auto" style={{ fontSize: 15 }}>
                  {post.title}
                </strong>
                <p className="sc-post-body" dir="auto">
                  {post.content}
                </p>

                {post.resourceUrl && (
                  <div>
                    <a
                      className="st-btn"
                      href={post.resourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={13} />
                      <span>{ui.openLink}</span>
                    </a>
                  </div>
                )}

                {post.tags.length > 0 && (
                  <div className="st-row">
                    {post.tags.map((tag) => (
                      <span key={tag} className="st-pill">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="st-head-row">
                  <div className="st-row">
                    <button
                      type="button"
                      className={`st-btn${post.likedByMe ? " is-primary" : ""}`}
                      onClick={() => void handleToggleLike(post.id)}
                    >
                      <Heart size={13} />
                      <span>{post.likesCount}</span>
                    </button>
                    <button
                      type="button"
                      className="st-btn"
                      onClick={() => void handleToggleComments(post.id)}
                    >
                      <MessageCircle size={13} />
                      <span>
                        {post.commentsCount} {ui.comments}
                      </span>
                    </button>
                  </div>
                  {!post.isMine && (
                    <button
                      type="button"
                      className="st-btn"
                      onClick={() =>
                        setReportingPostId((cur) =>
                          cur === post.id ? null : post.id,
                        )
                      }
                    >
                      <Flag size={13} />
                      <span>{ui.report}</span>
                    </button>
                  )}
                </div>

                {reportingPostId === post.id && (
                  <div className="sc-report-box">
                    <strong style={{ fontSize: 12.5 }}>{ui.reportTitle}</strong>
                    <AppSelect
                      title={ui.reportTitle}
                      value={reportReason}
                      dir={isRtl ? "rtl" : "ltr"}
                      options={(
                        Object.keys(ui.reportReasons) as CommunityReportReason[]
                      ).map((r) => ({ value: r, label: ui.reportReasons[r] }))}
                      onChange={(v) => setReportReason(v as CommunityReportReason)}
                    />
                    <input
                      className="st-input"
                      dir="auto"
                      placeholder="..."
                      value={reportDetails}
                      onChange={(e) => setReportDetails(e.currentTarget.value)}
                    />
                    <div className="st-row">
                      <button
                        type="button"
                        className="st-btn is-danger"
                        onClick={() => void handleSubmitReport(post.id)}
                      >
                        {ui.sendReport}
                      </button>
                      <button
                        type="button"
                        className="st-btn"
                        onClick={() => setReportingPostId(null)}
                      >
                        {ui.cancel}
                      </button>
                    </div>
                  </div>
                )}

                {commentsOpen && (
                  <div className="sc-comments-box">
                    {comments.map((c) => (
                      <div key={c.id} className="sc-comment-row">
                        <strong>{c.authorName}</strong>
                        <span dir="auto">{c.content}</span>
                      </div>
                    ))}
                    <div className="st-row">
                      <input
                        className="st-input"
                        style={{ flex: 1 }}
                        dir="auto"
                        placeholder={ui.commentPh}
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        className="st-btn is-primary"
                        disabled={commentBusy || !commentDraft.trim()}
                        onClick={() => void handleAddComment(post.id)}
                      >
                        <Send size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}